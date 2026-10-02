# choice（异步行动选项）— 项目说明

SillyTavern 第三方扩展，基于 `tavern_extension_template`。核心：单独调用 API 异步生成行动选项，供玩家点选后填入或发送。技术栈 TypeScript + Vue 3 SFC + Pinia + Zod + Vite；发布产物 `dist/index.js` + `dist/index.css`（production 另有 `.map`），随仓库装到酒馆真实扩展目录加载。

## 协作约定

- 回复用中文；代码注释简体中文、简洁，解释「为什么」而非「做什么」。
- 本文件分两类：**约束/不变量**（正确性、真 footgun）与**现状快照**（当前实现/风格，可推翻）。**用户当前给的 UI 示例、设计方向、口头指示优先级最高**——改版可整体换主题色/布局/组件，只要不破坏约束里的功能语义。
- 任何 `@sillytavern/...` 导入的签名/导出名不凭记忆，实现前先去真实酒馆源码或 `TavernHelper` 类型定义核实。
- `pnpm watch` 由你在独立终端跑，agent 只用一次性的 `build`/`typecheck`/`lint` 自查。
- 改动收尾把本文件里受影响的「规划/待办」条目顺手改成「现状」（或反之），防文档漂移；不要把未实现的目标写成已实现。
- 核心交互/UI 改动需浏览器验证；纯文案、纯逻辑且不影响 UI 的小改动可跳过。

## 关键架构约束

- **技术栈边界**：TS、Vue 3 SFC、Pinia、Zod、原生 CSS。不引入 jQuery/手写 DOM；拖拽排序用现有 `sortablejs` 封装。不接入 Tailwind/UnoCSS 运行时（只是开发依赖）。
- **设置走 Pinia store**：组件不直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`，经对应 `useXxxStore()`，同步逻辑集中在 `src/store/`。
- ⚠️ **角色绑定/解绑是唯一直接写 `character.data.extensions` 的例外**：入口只同步写内存 + `setBinding()` 换设置对象，持久化仅由 character-settings 的 deep watch 统一落盘（`persistCharacter` 直 POST `/api/characters/edit`）。入口不要再显式 `persistCharacter`（重复全量序列化→绑定卡顿）；严禁 `saveCharacterDebounced` 持久化扩展字段（旧 json_data 快照覆盖刚写字段→绑定失效）。唯一受控例外是 v33/v44 迁移期 `rebindConfigId`/`rebindPromptConfigId` 回写。
- ⚠️ **条目池两层结构**：`master_pool` 是内容真相源（`id/type/content/rule/category` + 默认 `pinned/weight`）；`configs[]` 只引用/覆盖（`enabled/pinned/weight`）、不持正文。config 选择是**覆盖式** `chat > character > default`，命中后只用该 config、不合并多个；内容/类型/规则/分类必须从 master_pool 读。提示词配置同理覆盖式。
- **提示词组装走角色结构**：`system` 放规则（人称/格式/字数），`user` 放抽中的素材与上下文截取，可选 `assistant` 放格式起手式（预填充开时保持 assistant，关时仅「思维链预填」「润色应答」两模块转 system）。
- **楼层持久化挂消息对象**：结果写 `message.extra['choice']`，按 `swipe_id` 分层；同楼多次生成用 `generations[] + currentIndex` 翻页，润色另用 `enrichGenerations`/`enrichCurrentIndex`。
- **第三方桥接可选**：`baibai/ejs/shujuku-bridge` 等检测能力，不可用时主体功能照常。
- **生成模块是可排序可启停管线**：`prompt_rules.modules` 用 `order/enabled/enrich_only` 控制；`enrich` 必须排在 assistant 相关模块之前。
- **世界书临时改写走互斥窗口**：`applyWIExcl` 是对酒馆全局 WI 状态的 save/restore，选项/润色/卡牌池三条生成链路一律经 `generator.runWIExclWindow` 包裹 resolve→apply→构建消息（构建完即还原——副 API 直连不再读酒馆世界书，排他态勿持有到请求结束）；新增生成链路绕过它会在并发时 restore 交错践踏酒馆 WI 状态。
- **酒馆 API 隔离**：版本敏感 API 只出现在 `src/core/`、`src/store/` 与根入口 `src/index.ts`；组件层一律经桥接层中转（`this_chid`/`eventSource` 等走 st-world-info 再导出）。放行清单：`uuidv4`（scripts/utils，稳定 util 任意层可用）；`util/character-bindings.ts`（绑定持久化单一通道）与 `util/option-action.ts`（共享点击层）可直接导入 `@sillytavern/script`。

## 领域模型要点

**行动选项统计**（`GlobalSettings.stats` + `src/core/stats.ts`）：两个独立开关——`stats_enabled`（默认关，采集总开关）、`automation_enabled`（默认关，自动化总开关，关则建议/阵容/L1/L2 全停）。只计「选项视图」，润色不计。v51 起按 config 维度记录 `stats.entries`（键 = 生效 `config.id`，无 config = `'__none__'`）。归因：参与 = 进候选（每轮 `poolEntryIds` 全记含 pinned）；命中 = 精确文本匹配（生成时写 `options[].matchedEntryId` 随消息持久化），点击只对匹配条目计命中、AI 舍弃候选与被匹配不上的选项不产生命中。期望 = 采纳感知随机基线（只在该条目被采纳输出的轮次累计 `matched/count`），固定阈值已废弃。滑动窗口 `recent`（FIFO 50）。**建议引擎永不停用——动作只有 down/up 改权重，绝不置 enabled=false**；降 ≤−0.2 / 提 ≥+0.15 / 中性带回捞；pinned/停用/删除跳过；冷却（`last_weight_changed_at`）防振荡；应用走 config 覆盖层、入持久撤销槽 `apply_history`（上限 20），撤销为按条目条件逆操作。`entryMetrics` 是建议与阵容共用解析（窗口 ≥10 优先、否则全量 ≥10）。阵容计划 `planRoster` 管成员资格（落出 = 软停用、补入 = 引用进 config）。AI 增强可选：L1 归因（`reconcileAttribution` 对称修正）+ L2 建议理由（按 `ScopeStats.updated_at` 失效、`suggestion_key` 增量复用），只展示不改动作。统计页 `Statistics.vue` 单子区 + 可折叠分区。

**骰子判定**（`GlobalSettings.dice`，默认关）：AI 在标题标需求值（`[标题|档位|70]`），未标按档位兜底（`gradeFallbackRate` 模式感知：DND 保守 35/平衡 60/大胆 85；COC 按 100−v 对偶为 65/40/15，两模式成功率一致——COC 第三段语义=能力值，越有把握标得越高）。点选项掷 D100：roll≥96 大成功 → roll≤5 大失败 → roll≥需求 成功 → 失败（彩蛋优先），**掷出 ≥ 需求才算成功、点数越大越好**。v61 增量（默认关）：`low_roll`（COC 反向：≤需求=成功）、`attr_dc_enabled`（角色属性驱动 DC，仅属性来源反向）、`allow_formula`（骰式 NdM）、`reroll_enabled`（就地重掷两步流）。判定方向抽象在 `src/core/dice.ts`（`judgeOutcome`/`DiceRollMode`/`diceMargin`）。判定影响 `buildDiceMarker` 包成 HTML 注释（v67 三段结构：代码固定头部「结局/裁定对象/点数/需求/差值/程度」——结局显式给键免弱模型从程度词反推、裁定对象=选项标题回显消歧，margin 参数必传勿恢复默认值[默认隐含 high 口径，low 模式忘传会反号] + 模板正文（默认=纯演绎指令，12 条新默认经 v67 exact-match 迁移换新，用户自定义过的保留）+ 固定纪律尾注 `DICE_MARKER_TAIL`——纪律=正文不得提判定细节、不得模仿注释格式；四种行为（send/fill/insert/append）输入框一律只放纯正文，注释经挂起判定（dice-contract.ts `stagePendingTurn`）在玩家消息真正发出时由 MESSAGE_SENT 回写进该消息 mes（时序早于 Generate 提示词构建——script.js:4394 sendMessageAsUser 先行、5858 emit，已核对源码；发送失败/未发送则挂起保留至同内容后发或下次点选覆盖，CHAT_CHANGED 清空防跨聊天误挂），AI 请求原样携带、聊天渲染与输入框均不可见、随消息持久化。`main_ai_awareness`（默认开）双通道注入（均收敛在 `dice-contract.ts`）：① 常驻契约 `syncDiceContractPrompt`（key `choice_dice_contract`，IN_CHAT depth 4 system）教「消息开头注释是骰子裁定指令」；② 每回合动态槽 `armDiceTurnPrompt`/`clearDiceTurnPrompt`（key `choice_dice_turn`，IN_CHAT depth 1 system）在 send 点选判定后挂「本回合已裁定：结局（程度）[受卡牌影响]」的即时摘要——位置贴近生成点、不依赖注释在历史中存活；fill/insert/append 由 `flushPendingTurnMarker` 回写时以完整判定注释覆盖本槽（send 回写同样覆盖，摘要即兜底）；AI 回复落地/中止即清空（`index.ts` 订阅 GENERATION_ENDED/GENERATION_STOPPED/MESSAGE_RECEIVED，事件名已核对酒馆源码），send 异常/取消路径同步撤下，开关关闭即置空撤销——**两个槽 + MESSAGE_SENT 消息内回写是扩展对正文 AI 请求的全部注入通道，新增注入必须收敛进 dice-contract.ts**。`low_roll` 开启时生成端运行时追加 COC 语义教学行（覆盖 core_rules 默认的「越难标得越高」，否则 AI 按难度制标注会让 low 模式难度反转）。需求值徽标 + 行内判定 chip（结局+差值、3s 淡出、内存态不持久化；徽标 tooltip v67 起按判定方向注明「掷 ≥/≤ 该值成功」）在主面板与悬浮球同步实现——**判定 chip 的内存态逻辑两处各自实现，属既定并行模式，改动需两处同步**；判定不弹 toastr。

**卡牌系统**（`GlobalSettings.card_*`，`card_enabled` 默认关）：判定管线叠加层，只在 `card_enabled=true` 且非骰式（`allow_formula`）路径生效（`resolveCardRoll`），关则零回归。4 类型槽（武器/法术/祝福/试炼，`CARD_SLOT_TYPES`）+ 星级预算（3★≤2/4★≤1/5★≤1）；效果分预掷（roll_bonus/demand_mod/crit_window，正向 success_delta/fail_delta=扩对应彩蛋窗口、正值更频繁，按判定方向模式感知升降阈值，掷前触发卡在掷骰前施加）与后置（outcome_convert/reroll/narrative）——掷后触发卡（roll/outcome 触发）的修正型效果在掷骰后**补算到已掷结果上并重判结局**（两遍后置：先补算重判、再转化/重掷/叙事），卡叙事并入判定 HTML 注释。卡为**永久收藏**（v66 起无耐久/等级，重复获得折算 `CARD_DUPLICATE_VALUE` 行动币）；经济单线：结局收支行动币（+5/+2/−1/−3）→ 收藏页 5 币开包 3 选 1，幸运数按**原骰**（卡牌加成前）命中也触发开包（high 模式 100 / low 模式对偶数 1）；开包弹窗「稍后再选/×/点遮罩」一律**挂起 offer**（`card-pack-state.parkedCardPack`，收藏页「待开启卡包」重开；挂起槽单槽——已有挂起时保留先挂起的、后关闭的丢弃并由弹窗 toast 明示），仅选中后才清除——购买已扣币、丢弃 offer 即白扣，勿改回直接关闭；卡叙事并入注释前经 `sanitizeNarrative` 滤连续连字符（防 `-->` 提前闭合注释泄漏正文）；保底/商店/每日任务/分解/血战/副本/技能卡/诅咒均已在 v66 瘦身裁撤，勿回填。角色主题池由 AI 懒生成（`cards-ai.ts`，开启卡牌开关 / 幸运开包 / 购买开包时触发 `ensureCharacterPool`）入 `card_definitions` 混合掉落。生成请求注入与选项生成**同源同法**的上下文：世界书全套 buckets（先 `resolveWIParticipation`→`applyWIExcl` 激活、`finally restore`，`world_info.enabled` 关则跳过世界书）+ 扮演者 persona + 角色背景/性格/场景（`readCharacterFields` 含 V1 兜底）+ 聊天记录（`buildChatHistory(context_rounds)`）——复用 `generator.ts` 导出的 `buildWI`/`buildChatHistory`/`applyWIExcl`/`resolveWIParticipation`，不另写一份。生成结果做防重复（`cards-ai.ts` 内 `normalizeName`/`cardSignature`/`isDuplicateCard`，确定性同构签名：name 归一相同 或 type+trigger+effects 签名相同即剔除；参照 = 同批已保留 + 该角色池既有卡 `refCards`（后者因池 fixed 后不重生成、structurally 恒为空，仅防御历史脏数据；实际生效的是批内去重），不含内置/其它角色）。数值越界（roll_bonus±30/demand_mod±40/crit_window±5/narrative 40）由 `clampEffect` **静默钳到上限并据此判重**（非作废）；仅结构非法（缺名/枚举非法/效果集被滤空）→该张作废、整批保留合法张后生成（全作废不置位 `generated`，下次掉落重试）。主题卡带归属字段 `character_id/character_name`（生成时填，CardFace 显示角色名角标；旧主题卡由 `cardDefById` 从 `card_character_pools` 幂等回填）——多池混排时一眼可辨归属。AI 生成引导**贴合角色背景**（卡名/叙事用角色独有词汇意象、效果与设定逻辑关联）且**双刃/代价卡**（试炼槽高风险高收益，`roll_bonus/demand_mod/crit_window` 的 amount 可负即 debuff，纯负卡玩家不装故重点是代价+收益组合）。防刷：同楼层（message+swipe）只结算一次卡牌经济（`cardSettled`）。点选前「可触发」空心 chip（`previewTriggeredCards`，只匹配 type/grade/demand 掷前可知触发，与判定路径同门控：骰子关 / 骰式开 / 楼层已结算时不预告；结算态非响应式，重算靠 `cardSettleEpoch` 响应式纪元——markCardSettled 自增、跨组件即时撤下，勿改回各组件本地 rollResults 依赖）与点选后已触发实心 chip 同属主面板/悬浮球双渲染并行模式，改动需两处同步；预掷（重掷两步流首掷）与 onReroll 同样传 `cardDisabled: layerSettled()` 门控，保证预告与实际应用口径一致。**机械效果触发也产叙事行（v67）**：`resolveCardRoll` 按效果收集 `effectNotes`（有前后值补「前→后」，如「骰值+15（52→67）」「需求−10（75→65）」「失败→成功」「重掷（43→78）」），无任何叙事文本（narrative 效果未命中且卡无自带 narrative）的触发卡补一行「卡名发动：效果摘要」进 `narrativeLines`，且机械行统一前置一句「机制记录（仅供理解因果，勿在正文写数值）」定位语——化解数值语言与判定纪律尾注「正文不得提点数」的表面冲突，否则机械触发对正文 AI 完全不可见或被弱模型照抄进正文；生成端（`generator.ts`，与骰式行/COC 行共用 `appendRuntimeLine`）在 card_enabled+骰子开+非骰式时追加 `equippedCardsPromptLine`（`cards-deck.ts`）告知装备卡与发动面并附三条互动手法（demand 触发卡→选项需求值标进触发区间；type/grade 触发→题材/档位呼应；效果方向作选项张力来源），卡与选项双向配合（只告知不强制）。**卡定义/卡组解析簇在 `cards-deck.ts`**（`cardDefById`/`resolveEquippedCards`/`autoDeckCards`/`resolveDeckSlots`/`currentCardConfigId` 等）：拆分动机是 `cards.ts → cards-ai.ts → generator.ts` 循环依赖——generator 需要装备卡摘要做生成注入，不能 import cards.ts；cards.ts 对公开名 import + re-export 保持既有 import 点零改动，勿把 `cards-deck.ts` 反向接回 cards-ai/generator。`effectSummary`（效果文案）单一来源在 `cards-meta.ts`，cards.ts/卡面/判定 chip 共用，勿在别处再写一份。`outcome_convert.from` 枚举含 `crit_fail`（5★ 万象归元：大失败→大成功专属强力转化）。

## UI 要点（现状，可改）

- 当前主视觉 `--choice-primary` 蓝色系 + 克制卡片化；移动端优先（先在 ~380px 验证）。改版以用户示例为准。
- 选项 HUD 化：选项行本体样式（`.choice-option-*`/`.choice-roll-chip`）在 global.css 单一来源，主面板与悬浮球弹窗共用，两处不各自维护（防判定/选中态漂移）。
- 悬浮球弹窗是独立 UI、不复用主面板版式，但选项解析/行为复用共享层（`src/util/option-format.ts`/`option-action.ts`），弹窗内不另写一份。
- 入口保底护栏：悬浮球/魔棒/聊天面板三个可视化入口，`setEntryVisible` 拒绝关闭「最后一个开着的入口」；外观页 checkbox 与右键「隐藏」必须走它。
- z 序 token 值：`--choice-z-panel:10`、`-floating:30000`、`-dialog:30100`、`-dropdown:30200`、`-popover:30300`（遮罩/浮层 z 序需可预测，改版另立体系前先确认）。
- 共享组件在 `src/components/shared/`（`ChoiceDialog`/`ChoiceSectionCard`/`tab-definitions`/`useCompactLayout` 等）；共享样式原子在 `src/global.css`。仅部分组件在使用，其余为预备态，迁移弹窗时逐个验证遮罩/Escape/动画/窄屏。

## 目录

- `src/core/`：生成器 `generator.ts`、抽取 `pool-resolver.ts`、去重 `option-dedup.ts`、消息持久化 `options-store.ts`、统计/建议/撤销 `stats.ts`、L1 归因 `ai-attribution.ts`、L2 理由 `ai-analysis.ts`、骰子 `dice.ts`/`dice-expression.ts`/`attribute-dc.ts`/`dice-contract.ts`（正文 AI 判定契约注入）、卡牌 `cards.ts`/`cards-deck.ts`（卡定义/卡组解析簇，防 generator 循环依赖）/`cards-builtin.ts`/`cards-constraints.ts`/`cards-meta.ts`/`cards-ai.ts`/`card-pack-state.ts`、浮动/入口/面板 `floating-state.ts`/`entry-points.ts`/`panel-mount.ts`、副 API `api-client.ts`/`api-presets.ts`、引导 `onboarding.ts`/`guide-content.ts`、绑定 `bindings.ts`、常量 `constants.ts`，以及可选桥接 `baibai/ejs/shujuku/st-character/st-regex-source/st-world-info`（`@sillytavern/*` 导入口径以「关键架构约束·酒馆 API 隔离」为准，组件层经桥接层中转）。
- `src/store/`：`global-settings`/`character-settings`/`chat-settings`/`pool-selector`/`prompt-config-selector`/`panel-state`。设置 schema 唯一来源 `src/type/settings.ts`（当前 67）。
- `src/components/`：主面板 `ActionOptionsPanel`；悬浮 `FloatingBubble/Root/Settings/ContextMenu/Options`；9 个设置编辑器（`PoolEditor`/`GenerationSettings`/`PromptEditor`/`ApiEditor`/`WorldInfoEditor`/`FilterEditor`/`Statistics`/`AppearanceSettings`/`DebugSettings`）；卡牌 `CardPoolEditor`（卡牌页壳）/`CardDeckEditor`/`CardSlotPicker`/`CardLibrary`/`CardCollection`/`CardFace`/`CardPackDialog`；条目池/导入/引导/通用弹窗若干——改组件前先翻目录确认。
- `src/util/`：选项解析 `option-format.ts` + 点击行为 `option-action.ts` 是主面板与悬浮球共用共享层；`character-bindings.ts`（`getBoundCharacters` + `persistCharacter`）；时间格式化/条目预览等。
- 根级：`src/index.ts`、`src/pinia.ts`、`src/theme.css`、`src/global.css`。

## 新手引导

内容单一来源 `src/core/guide-content.ts`（`GUIDE_CHAPTERS` 7 章 + `PAGE_HINTS` 8 子区 + `DIALOG_HINTS`）。`quick-start` 为唯一默认路径，另有 6 进阶章。题首 🎓/❓ 打开章节菜单 / 结构化 `PAGE_HINTS`；唯一受控 `v-html` 例外是 `OnboardingWizard` 步骤富文本（内容 100% 来自编译期静态脚本，勿传用户可控数据）。`data-tour` 锚点分散在组件模板，增删向导步骤时同步检查。`docs/` 下无设计参考文档，当前源码是唯一标准。

## 条目池模型与抽取算法

- `PoolEntry`：`id/type/content/rule/pinned/weight/category`，`pinned/weight` 可被 `PoolConfigEntry` 覆盖；`rule` 是写作约束非选用门槛。
- **配置级规则**：`PoolConfig` 只有单一自由文本 `rules`；生成选项时内联拼在 `{{pool_selected}}` 展开值末尾、不加标签，随 option_task 的 user 消息发出。
- **选项输出契约（JSON 主路径 + 括号回退）**：AI 输出 `<options>` 内 JSON 数组（`{"title":"标题|档位|需求值","content":"正文"}`）；`parseOptions` 以 JSON 为主（content 可含任意字符而不切分），失败回退 `[标题]内容` 括号启发式。奖励标记（`【系统奖励：…】`）是内容不是结构。
- 抽取顺序：解析 effectivePool → 拆固定/非固定并处理固定溢出 → 按 category 分组处理下溢 → 分组轮询、组内 Efraimidis–Spirakis 加权无放回抽取 → 按 `oversamplePct` 补充 → 送 prompt 前整体 shuffle（`src/core/pool-resolver.ts` 为准）。
- `cross_layer_fallback` 已删除，勿重新引入。

## 构建与验证

```bash
pnpm build       # production 构建 → dist/
pnpm typecheck   # 等价 npx vue-tsc --noEmit
pnpm lint        # ESLint
pnpm format      # Prettier
npx knip         # 死代码扫描（klona/pinia/toastr 在 knip.json ignoreDependencies、ignoreExportsUsedInFile 开启——模块内自用的语义导出不报，勿手动移除）
```

无单测，靠 typecheck/build/lint + 按改动范围浏览器验证。核心交互/UI 改动至少确认：链路可操作、窄屏不横向溢出、console 无新增 Vue/Pinia 报错。远程 action 在发布分支 production bundle 并提交 `[bot] Bundle`，提交时不要为 map/CSS 产物状态额外重跑发布流程。

## 分支纪律

- `main` 发布线，只从 `test` 同步源码，dist 归 bot bundle；`test` 是 bug fix 主战场；`feat/passive-status` 只做被动状态。
- 大版本 `test → main`：`git merge test --no-ff -X theirs`，合并后 `git restore --source=<merge 前 main sha> dist` 恢复 main 侧 dist 让 bot 重出；merge 信息带 `[release minor/patch/major]`（bundle CI 自动 bump 版本/tag，勿手改版本号）。
- 增量 bugfix 用 `git cherry-pick -n <sha>` 只搬源码；dist 冲突保留 main 侧。`feat` rebase 中 `ours` = 新 base，dist 用 main 侧。
- 同步前先查远端 main 最新提交（有定期依赖更新 action 可能造成 drift）。

## 实现前核实的酒馆接口

- `TavernHelper`/`generateQuietPrompt`/`generateRaw` 当前签名与 `AbortSignal` 支持。
- `setExtensionPrompt`（`script.js` 导出，签名 `(key, value, position, depth, scan, role, filter)`）与 `extension_prompt_types`/`extension_prompt_roles`；IN_CHAT 深度注入在文本补全（`script.js`）与聊天补全（`openai.js`）两条路径都消费，空 value 会被 `getExtensionPrompt` 过滤（v67 dice-contract 已按此实现并核对）。
- `#send_textarea`/`#send_but` 等 DOM id 与目标酒馆版本一致。
- `character.data.extensions` 命名空间的真实读写 API。
- `/api/characters/edit`：`json_data` 必须是角色完整卡 JSON（`ch.json_data` 快照，形如 `{spec, name, data:{...}}`），不能传 `ch.data` 子对象。
- 锁定版 `@vueuse/core ^13.9.0` 的 `useElementSize`/`onLongPress` 签名与触摸滚动边界。
