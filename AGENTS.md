# choice（异步行动选项）— 项目说明

SillyTavern 第三方扩展。核心：单独调用 API 异步生成行动选项，供玩家点选后填入或发送。技术栈 TS + Vue 3 SFC + Pinia + Zod + Vite；产物 `dist/index.js` + `dist/index.css`，随仓库装到酒馆真实扩展目录加载。

## 协作约定

- 回复用中文；代码注释简体中文、简洁，解释「为什么」而非「做什么」。
- 本文件分**约束/不变量**（正确性、真 footgun）与**现状快照**（当前实现/风格，可推翻）。**用户当前给的 UI 示例、设计方向、口头指示优先级最高**——可整体换主题色/布局/组件，只要不破坏约束里的功能语义。
- 任何 `@sillytavern/...` 导入的签名/导出名不凭记忆，实现前先去真实酒馆源码或 `TavernHelper` 类型定义核实。
- `pnpm watch` 由你在独立终端跑，agent 只用一次性的 `build`/`typecheck`/`lint` 自查。
- 改动收尾把本文件里受影响的「规划/待办」条目改成「现状」（或反之），防文档漂移；勿把未实现目标写成已实现。
- 核心交互/UI 改动需浏览器验证；纯文案、纯逻辑且不影响 UI 的小改动可跳过。

## 关键架构约束

- **技术栈边界**：TS、Vue 3 SFC、Pinia、Zod、原生 CSS。不引入 jQuery/手写 DOM；拖拽排序用现有 `sortablejs` 封装；不接 Tailwind/UnoCSS 运行时（仅开发依赖）。
- **设置走 Pinia store**：组件不直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`，经 `useXxxStore()`，同步逻辑集中在 `src/store/`。
- ⚠️ **角色绑定/解绑是唯一直接写 `character.data.extensions` 的例外**：入口只同步写内存 + `setBinding()` 换设置对象，持久化仅由 character-settings 的 deep watch 统一落盘（`persistCharacter` 直 POST `/api/characters/edit`）。入口勿再显式 `persistCharacter`（重复全量序列化→绑定卡顿）；严禁 `saveCharacterDebounced` 持久化扩展字段（旧 json_data 快照覆盖刚写字段→绑定失效）。唯一受控例外：v33/v44 迁移期 `rebindConfigId`/`rebindPromptConfigId` 回写。
- ⚠️ **条目池两层结构**：`master_pool` 是内容真相源（`id/type/content/rule/category` + 默认 `pinned/weight`）；`configs[]` 只引用/覆盖（`enabled/pinned/weight`）、不持正文。config 选择**覆盖式** `chat > character > default`，命中后只用该 config、不合并；内容/类型/规则/分类必须从 master_pool 读。提示词配置同理覆盖式。
- **提示词组装走角色结构**：`system` 放规则（人称/格式/字数），`user` 放抽中素材与上下文截取，可选 `assistant` 放格式起手式。模块一律按自身 `role` 发送；默认起手模块为 system 指令（不依赖模型预填充能力），想用预填充把模块角色改为 assistant 即可。v69 删全局预填充开关、v71 删 `prefill_enabled` 死字段、v72 删「应答声明」（assistant_ack）模块。
- **楼层持久化挂消息对象**：结果写 `message.extra['choice']`，按 `swipe_id` 分层；同楼多次生成用 `generations[] + currentIndex` 翻页，润色另用 `enrichGenerations`/`enrichCurrentIndex`。
- **第三方桥接可选**（`baibai/ejs/shujuku-bridge` 等），不可用时主体功能照常。
- **生成模块是可排序可启停管线**：`prompt_rules.modules` 用 `order/enabled/enrich_only` 控制；`enrich` 必须排在 assistant 相关模块之前。
- ⚠️ **世界书临时改写走互斥窗口**：`applyWIExcl` 是对酒馆全局 WI 状态的 save/restore，选项/润色/卡牌池三条生成链路一律经 `generator.runWIExclWindow` 包裹 resolve→apply→构建消息（构建完即还原——副 API 直连不再读酒馆世界书，排他态勿持有到请求结束）；新链路绕过它会在并发时 restore 交错践踏酒馆 WI 状态。窗口期经 `persist-gate.ts` 闸门推迟扩展自身两条持久化通道（`character-bindings` 的 persistCharacter、chat-settings 的 `saveMetadataDebounced`）到 restore 后放行——窗口内角色/聊天绑定书被临时置空，此刻序列化会把空绑定落盘；闸门不覆盖酒馆原生面板触发的保存（残余风险已在模块注释声明）。
- **酒馆 API 隔离**：版本敏感 API 只出现在 `src/core/`、`src/store/` 与根入口 `src/index.ts`；组件层一律经桥接层中转（`this_chid`/`eventSource` 等走 st-world-info 再导出）。放行清单：`uuidv4`（稳定 util 任意层可用）；`util/character-bindings.ts`（绑定持久化单一通道）与 `util/option-action.ts`（共享点击层）可直接导入 `@sillytavern/script`。
- **i18n 键 = 中文原文**：`i18n/en.json` 以中文源串做键；标签模板 `` t`xx:${v}` `` 的插值在酒馆侧转成 `${N}` 占位符参与查找（i18n.js:81 已核对）。改 UI 文案收尾跑 `pnpm i18n:check`（`tools/check-i18n.mjs`）对账：缺失/孤儿键必须归零，新键经 `--merge` 合入（守卫拒收代码未用的笔误键）。两约束：插值里**勿嵌反引号模板**（会让运行时键与提取口径错位，先算再插值）；多行键用真实换行（模板内写 `\n` 转义也可以，两者烤制后同键）。模板静态中文属性（`ChoiceSectionCard title="…"` 等 ~300 处）**尚未参与 i18n**，属已知债务，改造需逐处过浏览器验证，工具只做计数提示。

## 领域模型要点

### 行动选项统计（`GlobalSettings.stats` + `src/core/stats.ts`）

- 双开关均默认关：`stats_enabled`（采集）、`automation_enabled`（自动化，关则建议/阵容/L1/L2 全停）。只计「选项视图」，润色不计。
- v51 起按 config 维度记 `stats.entries`（键 = 生效 `config.id`，无 config = `'__none__'`）。
- 归因：**参与** = 进候选（每轮 `poolEntryIds` 全记含 pinned）；**命中** = 精确文本匹配——生成时写 `options[].matchedEntryId` 随消息持久化，本地匹配 = type 前缀优先 → bigram Dice ≥0.25 **且最优-次优分差 ≥ `OPTION_MATCH_MARGIN`(0.05)**，平票归属近随机归 null（宁缺勿错）；前缀认定要求**最长命中 type 唯一**——同 type 多条目竞争时前缀不可区分，一律落 Dice 靠分差裁决（首个前缀命中即返回会恒归候选序靠前者，系统性偏差）；点击只对匹配条目计命中，AI 舍弃候选与匹配不上的选项不产生命中。
- **期望** = 采纳感知随机基线（只在该条目被采纳输出的轮次累计 `matched/count`），固定阈值已废弃；窗口口径按 **scope 平均点选数 m̄ 校正**（`ScopeStats.total_rounds/picks_total` 计数、总轮数 ≥`AVG_PICKS_MIN_ROUNDS` 才启用，超几何 `randomPickHitProb`——多点选用户单点模型偏提权）；全量 `expected_sum` 保持单点模型，混合口径属可接受过渡。
- 滑动窗口 `recent`（FIFO 50）。
- **建议引擎永不停用——动作只有 down/up 改权重，绝不置 enabled=false**。降/提阈值 = 固定阈值(−0.2/+0.15) 与 SE×1.5 取大（`SUGGEST_THRESHOLD_SE_FACTOR`，样本越少门槛越高）+ 中性带回捞（`manualLow` 标记手动低权重，仅展示提示）；pinned/停用/删除跳过；权重到下限仍持续低迷 → 引擎沉默，由「已到下限」洞察徽标引导走阵容（勿当 bug 修回出建议）。
- 冷却（`last_weight_changed_at`）防振荡；超 `SUGGEST_COOLDOWN_MAX_MS`(7 天) 且 ≥`SUGGEST_COOLDOWN_MIN_POST`(3) 轮新数据放宽（低权重条目参与慢，纯按参与轮数等门槛会冷却黑洞）；判定收敛在 `cooldownStillActive`，entryMetrics 与「冷却中」徽标共用勿各写一份。
- 应用走 config 覆盖层、入持久撤销槽 `apply_history`（上限 20），撤销为按条目条件逆操作。
- `entryMetrics` 是建议与阵容共用解析（窗口 ≥10 优先、否则全量 ≥10）；avgPicks 经 `StatsView.avgPicks` 由各调用方显式透传，勿改成 row 携带——planRoster 直读 `view.by_entry` 原始记录会静默丢口径。
- 阵容计划 `planRoster` 管成员资格：落出 = 软停用、补入 = 引用进 config；探索补入每次至多填一半空位。
- AI 增强可选，只展示不改动作：L1 归因（`reconcileAttribution` 对称修正；**先写回消息、成功才修统计**——反转即产生「统计已修、消息未写回」的单侧分裂；解析逐条降级容错弱模型）+ L2 建议理由（按 `ScopeStats.updated_at` 失效、`suggestion_key` 增量复用，指纹全未变时原地改缓存时间戳不重建对象）。
- 统计页 `Statistics.vue` 单子区 + 可折叠分区；「应用全部」确认弹窗受搜索/筛选影响时注明范围。

### 骰子判定（`GlobalSettings.dice`，默认关）

- AI 在标题标需求值（`[标题|档位|70]`），未标按档位兜底（`gradeFallbackRate` 模式感知）：DND 35/60/85；COC 按 100−v 对偶为 65/40/15（COC 第三段语义 = 能力值，越有把握标得越高，两模式成功率一致）。
- 点选项掷 D100：roll≥96 大成功 → roll≤5 大失败 → roll≥需求 成功 → 失败（彩蛋优先）。**掷出 ≥ 需求才算成功、点数越大越好**。
- v61 增量（默认关）：`low_roll`（COC 反向：≤需求=成功）、`attr_dc_enabled`（属性驱动 DC，刻度自适应：≤20 视 DND 3-18 刻度按 ×5 换算、>20 视 COC 百分位原样——纯 100−v 会让 3-18 值域几乎必败）、`allow_formula`（骰式 NdM）、`reroll_enabled`（就地重掷两步流）。判定方向抽象在 `src/core/dice.ts`（`judgeOutcome`/`DiceRollMode`/`diceMargin`）。
- 判定影响 `buildDiceMarker` 包成 HTML 注释（v67 三段）：① 代码固定头部「结局/裁定对象/点数/需求/差值/程度」（结局显式给键免弱模型从程度词反推；**margin 参数必传**——默认隐含 high 口径，low 模式忘传会反号）；② 模板正文（默认 = 纯演绎指令，12 条新默认经 v67 exact-match 迁移，用户自定义过的保留）；③ 固定纪律尾注 `DICE_MARKER_TAIL`（正文不得提判定细节、不得模仿注释格式）。程度档位 v73 起按差值占判定空间的比例切档（`degreeBucket` 单一入口，mode+bounds 定空间；固定绝对值断点废弃，词与档位同源勿各写一份）。
- 四种行为（send/fill/insert/append）输入框一律只放纯正文；注释经挂起判定（dice-contract.ts `stagePendingTurn`）在玩家消息真正发出时由 MESSAGE_SENT 回写进该消息 mes（时序早于 Generate 提示词构建）；发送失败/未发送则挂起保留至同内容后发或下次点选覆盖，CHAT_CHANGED 清空防跨聊天误挂。AI 请求原样携带、聊天渲染与输入框均不可见、随消息持久化。
- `main_ai_awareness`（默认开）双通道注入，均收敛在 `dice-contract.ts`：① 常驻契约 `syncDiceContractPrompt`（key `choice_dice_contract`，IN_CHAT depth 4 system）教「消息开头注释是骰子裁定指令」；② 每回合动态槽 `armDiceTurnPrompt`/`clearDiceTurnPrompt`（key `choice_dice_turn`，IN_CHAT depth 1 system）挂「本回合已裁定：结局（程度）」即时摘要（贴近生成点，不依赖注释在历史中存活；fill/insert/append 由 `flushPendingTurnMarker` 回写成功后挂同一份）。AI 回复落地/中止即清空（`index.ts` 订阅 GENERATION_ENDED/GENERATION_STOPPED/MESSAGE_RECEIVED），send 异常/取消同步撤下，开关关闭即置空撤销——**两个槽 + MESSAGE_SENT 消息内回写是扩展对正文 AI 请求的全部注入通道，新增注入必须收敛进 dice-contract.ts**。
- `low_roll` 开启时生成端运行时追加 COC 语义教学行（覆盖 core_rules 默认的「越难标得越高」，否则难度反转）。
- 需求值徽标 + 行内判定 chip（结局+差值、3s 淡出、内存态不持久化）在主面板与悬浮球同步实现——**判定 chip 的内存态逻辑两处各自实现，属既定并行模式，改动需两处同步**；判定不弹 toastr。需求值徽标语义色（`rateClass`）按判定方向分档（low 镜像：值越大越易），两处同款实现同步改。

### 卡牌系统（`GlobalSettings.card_*`，`card_enabled` 默认关）

- 判定管线叠加层，只在 `card_enabled=true` 且非骰式（`allow_formula`）路径生效（`resolveCardRoll`），关则零回归。4 类型槽（武器/法术/祝福/试炼）+ 星级预算（3★≤2/4★≤1/5★≤1）。
- 效果分预掷（roll_bonus/demand_mod/crit_window/success_delta/fail_delta，正向 delta = 扩彩蛋窗口，按判定方向模式感知升降阈值，掷前施加）与后置（outcome_convert/reroll/narrative）——掷后触发卡（roll/outcome 触发）的修正型效果**补算到已掷结果上并重判结局**（两遍后置：先补算重判、再转化/重掷）。数值效果极性约定（`resolveCardRoll` 的 `modeSign`）：**正 roll_bonus = 利好、正 demand_mod = 代价，两模式一致**——low 模式施加前按判定方向取反（利好 = 降骰/升需求）；卡面 `effectSummary` 显示设计原值，机制行 note 显示实际施加方向。
- **卡牌叙事不注入正文 AI**：narrative 效果类型与 Card.narrative 字段保留（卡面/卡组展示、AI 生成引导、校验/判重照常），判定注释只注入**机制行**（触发卡效果摘要，含前后值「前→后」，前置定位语「机制记录（仅供理解因果，演绎时转化为剧情表现，勿在正文写数值）」）——演出/叙事行、满编共鸣叙事句已移除不注入，防弱模型生搬卡名/台词进正文。
- **机械机制行（v67 起、v69 全量）**：`resolveCardRoll` 按效果收集 `effectNotes`（有前后值补「前→后」），**所有触发卡**（不限无叙事卡——避免「有描写、无因果」）产出「「卡名」发动：效果摘要」行。生成端（与骰式行/COC 行共用 `appendRuntimeLine`）在 card_enabled+骰子开+非骰式时追加 `equippedCardsPromptLine`：告知装备卡与发动面 + 三条互动手法（demand 触发卡→需求值标进触发区间；type/grade 触发→题材/档位呼应；效果方向作选项张力来源），只告知不强制。
- **永久收藏 + v70 磨损/修复**：每次触发判定扣 1 耐久，归零破损自动卸下禁装，行动币修复回满（耐久 = 星级基础×功能修正，修复成本按星级递增）。破损过滤统一在 `resolveEquippedCards`/`autoDeckCards`/`equipCard`，选卡器不列破损卡；耐久消耗在 `commitCardRun` 内与 `trigger_count` 同门控（同层只扣一次、预览/首掷 stage 不扣），破损即时 chip+toastr。重复获得折算 `CARD_DUPLICATE_VALUE` 行动币；破损卡抽到照常折算、不刷新破损（防免费刷新绕开修复经济）。
- 经济：结局收支行动币（+5/+2/−1/−3）→ 收藏页 5 币开包 3 选 1 + 破损修复支出；幸运数按**原骰**（卡牌加成前）命中也触发开包（high 100 / low 对偶 1）。开包弹窗「稍后再选/×/点遮罩」一律**挂起 offer**（`card-pack-state.parkedCardPack`，收藏页「待开启卡包」重开；挂起槽单槽——已有挂起时保留先挂的、后关的丢弃并 toast 明示），仅选中后才清除——购买已扣币，勿改回直接关闭。机制行并入注释前经 `sanitizeNarrative` 滤连续连字符（防 `-->` 提前闭合注释泄漏正文）。
- 防刷：同楼层（message+swipe）只结算一次判定——`cardSettled` 标记同时覆盖卡牌经济与骰子战绩（`recordDiceRoll` 等），首次应用即标记（卡牌关/骰式路径同样生效），同层换选项/反复重掷不重复记账。结算态非响应式，重算靠 `cardSettleEpoch` 响应式纪元（markCardSettled 自增、跨组件即时撤下，勿改回各组件本地 rollResults 依赖）。点选前「可触发」空心 chip（`previewTriggeredCards`，只匹配掷前可知的 type/grade/demand，与判定路径同门控）与点选后实心 chip 同属主面板/悬浮球双渲染并行，改动需两处同步；预掷与 onReroll 同传 `cardDisabled: layerSettled()` 保证预告与实际口径一致。
- 满编共鸣（`resolveCardRoll` 收尾段，计入 `setBonus`，与结局无关）：4 槽全装且本次有卡触发 → +1 币。
- 保底/商店/每日任务/分解/血战/副本/技能卡/诅咒已在 v66 裁撤，套装与收藏成就已在 v68 裁撤，勿回填。
- **角色主题池 AI 分批生成**（`cards-ai.ts`，触发点 = 开启卡牌开关/幸运开包/购买开包，经 `ensureCharacterPool`）：首批 `CARD_POOL_FIRST_BATCH=4`（池空）、每批 `CARD_POOL_BATCH_SIZE=2`、上限 `CARD_POOL_MAX_CARDS=12`（满池停自动补充，「重新生成」清池重来）；`generated=true` = 池已初始化（首批后置位），此后只追加。`generateCharacterPool` 入口**串行排队**（手动/自动两套调用方闸门互不相通，并行批会双双超上限 + 跨批判重互看不到——每批实际开跑才读池快照）、单批超量截断到 target、落库再钳上限。**勿拆串行链、勿改回一次性整池**——每批吃触发时刻的剧情上下文，池随剧情阶段变宽，一次全生成只反映开局面导致内容窄化。生成过程 toastr 提示（未配副 API 静默 = 功能未启用常态）。
- 生成请求注入与选项生成**同源同法**，桶序对齐 DEFAULT_MODULES：persona → 世界书 before 桶 → 角色字段（`readCharacterFields` 含 V1 兜底）→ **世界书 after 桶 → depthBefore 桶 → 聊天记录 → depthAfter 桶**（after/depthBefore 属历史之前的背景层，放历史后会让设定条目跑到聊天后面）+ 世界书全套 buckets（先 `resolveWIParticipation`→`applyWIExcl` 激活、`finally restore`；`world_info.enabled` 关则跳过）——复用 `generator.ts` 导出的 `buildWI`/`buildChatHistory`/`applyWIExcl`/`resolveWIParticipation`，不另写一份。聊天走 `buildChatHistory(context_rounds, false)`（不包裹 `<current_scene>`）且历史前插用途声明：「不得绑定当前场景/事件」约束在 SYSTEM_PROMPT、历史前声明、user 任务三处同发（防弱模型把卡写成当前剧情专用）。
- 生成结果防重复（`normalizeName`/`cardSignature`/`isDuplicateCard`）：name 归一相同 或 type+trigger+effects 签名相同即剔除；参照 = 同批已保留 + 该角色池既有卡（跨批判重真实生效；不含内置/其它角色）；已有卡摘要随请求下发要求题材错开。数值越界由 `clampEffect` **静默钳到上限并据此判重**（非作废）；trigger 交叉字段幻觉由 `normalizeTrigger` 按 kind 只留相关字段（id/name/trigger/effects 是持久化投毒的四个栅栏——枚举外值落库会让下次加载 zod 整档崩）；结构非法（缺名/枚举非法/效果集滤空）与 `validateCard` 硬校验（效果数 >3、outcome_convert `from===to` 恒等、demand/roll 跨度 ≥80 且 star≥3 且效果全为利好向——极性按「正 roll_bonus=利好/正 demand_mod=代价」判，见 `isAllPositiveNumeric`）→ 该张作废、整批保留合法张（全作废不置位 `generated`，下次掉落重试）。生成引导：typeValue 用 2-4 字宽泛题材词（窄词匹配不到选项标题 = 死卡占池）、demand/roll 跨度建议 ≤60；题材贴合角色背景 + 双刃/代价卡（试炼槽 amount 可负即 debuff，重点是代价+收益组合）。
- 主题卡带归属字段 `character_id/character_name`（CardFace 显示角标；旧主题卡由 `cardDefById` 幂等回填）。
- **卡定义/卡组解析簇在 `cards-deck.ts`**（`cardDefById`/`resolveEquippedCards`/`autoDeckCards`/`resolveDeckSlots`/`currentCardConfigId` 等）：拆分动机是 `cards.ts → cards-ai.ts → generator.ts` 循环依赖——generator 需要装备卡摘要做生成注入，不能 import cards.ts；cards.ts 对公开名 re-export 保持既有 import 点零改动，勿反向接回。`effectSummary`（效果文案）单一来源在 `cards-meta.ts`，勿在别处再写。`outcome_convert.from` 枚举含 `crit_fail`（5★ 万象归元：大失败→大成功）。

## UI 要点（现状，可改）

- 主视觉 `--choice-primary` 蓝色系 + 克制卡片化；移动端优先（先在 ~380px 验证）。改版以用户示例为准。
- 选项行本体样式（`.choice-option-*`/`.choice-roll-chip`）在 global.css 单一来源，主面板与悬浮球弹窗共用，勿各自维护（防判定/选中态漂移）。
- 悬浮球弹窗是独立 UI、不复用主面板版式，但选项解析/行为复用共享层（`src/util/option-format.ts`/`option-action.ts`），弹窗内不另写一份。
- 入口保底护栏：悬浮球/魔棒/聊天面板三个入口，`setEntryVisible` 拒绝关闭「最后一个开着的入口」；外观页 checkbox 与右键「隐藏」必须走它。
- z 序 token：`--choice-z-panel:10`、`-floating:30000`、`-dialog:30100`、`-dropdown:30200`、`-popover:30300`（改版另立体系前先确认）。
- 共享组件在 `src/components/shared/`（`ChoiceDialog`/`ChoiceSectionCard`/`tab-definitions`/`useCompactLayout` 等），仅部分在用，其余为预备态；迁移弹窗时逐个验证遮罩/Escape/动画/窄屏。

## 目录

- `src/core/`：生成器 `generator.ts`、抽取 `pool-resolver.ts`、去重 `option-dedup.ts`、选项→条目归因 `option-attribution.ts`、消息持久化 `options-store.ts`、润色输入 `enrich-input.ts`、统计/建议/撤销 `stats.ts`、L1 `ai-attribution.ts`、L2 `ai-analysis.ts`、骰子 `dice.ts`/`dice-expression.ts`/`attribute-dc.ts`/`dice-contract.ts`（正文 AI 判定契约注入）、卡牌 `cards.ts`/`cards-deck.ts`（卡定义/卡组解析簇，防循环依赖）/`cards-builtin.ts`/`cards-constraints.ts`/`cards-meta.ts`/`cards-ai.ts`/`card-pack-state.ts`、浮动/入口/面板 `floating-state.ts`/`entry-points.ts`/`panel-mount.ts`/`wand-menu.ts`（魔杖菜单）、主题 `theme-detector.ts`/`theme-presets.ts`（ST 亮暗检测 / 主题注册表）、副 API `api-client.ts`/`api-presets.ts`、引导 `onboarding.ts`/`guide-content.ts`、绑定 `bindings.ts`、常量 `constants.ts`，及可选桥接 `baibai/ejs/shujuku/st-character/st-regex-source/st-world-info`。
- `src/store/`：`global-settings`/`character-settings`/`chat-settings`/`pool-selector`/`prompt-config-selector`/`panel-state`。设置 schema 唯一来源 `src/type/settings.ts`（当前 72）。
- `src/components/`：主面板 `ActionOptionsPanel`；悬浮 `FloatingBubble/Root/Settings/ContextMenu/Options`；9 个设置编辑器（`PoolEditor`/`GenerationSettings`/`PromptEditor`/`ApiEditor`/`WorldInfoEditor`/`FilterEditor`/`Statistics`/`AppearanceSettings`/`DebugSettings`）；卡牌 `CardPoolEditor`（页壳）/`CardDeckEditor`/`CardSlotPicker`/`CardLibrary`/`CardCollection`/`CardFace`/`CardPackDialog`；条目池/导入/引导/通用弹窗若干——改组件前先翻目录确认。
- `src/util/`：选项解析 `option-format.ts` + 点击行为 `option-action.ts`（主面板与悬浮球共用共享层）；`character-bindings.ts`（`getBoundCharacters` + `persistCharacter`）；时间格式化/条目预览等。
- 根级：`src/index.ts`、`src/pinia.ts`、`src/theme.css`、`src/global.css`、`env.d.ts`（CSS 副作用导入类型占位）。
- `tests/`：vitest 纯函数单测（`tests/*.test.ts`，只测不依赖酒馆运行时的模块）；`tools/`：Node CLI 工具（`check-i18n.mjs` 对账）。

## 新手引导

内容单一来源 `src/core/guide-content.ts`（`GUIDE_CHAPTERS` 7 章 + `PAGE_HINTS` 8 子区 + `DIALOG_HINTS`），`quick-start` 为唯一默认路径。题首 🎓/❓ 打开章节菜单/结构化 `PAGE_HINTS`。唯一受控 `v-html` 例外：`OnboardingWizard` 步骤富文本（内容 100% 来自编译期静态脚本，勿传用户可控数据）。`data-tour` 锚点分散在组件模板，增删向导步骤时同步检查。`docs/` 下无设计参考，当前源码是唯一标准。

## 条目池模型与抽取算法

- `PoolEntry`：`id/type/content/rule/pinned/weight/category`，`pinned/weight` 可被 `PoolConfigEntry` 覆盖；`rule` 是写作约束非选用门槛。
- **配置级规则**：`PoolConfig` 只有单一自由文本 `rules`；生成选项时内联拼在 `{{pool_selected}}` 展开值末尾、不加标签。
- **选项输出契约（JSON 主路径 + 括号回退）**：AI 输出 `<options>` 内 JSON 数组（`{"title":"标题|档位|需求值","content":"正文"}`）；`parseOptions` 以 JSON 为主（content 可含任意字符而不切分），失败回退 `[标题]内容` 括号启发式。奖励标记（`【系统奖励：…】`）是内容不是结构。
- 抽取顺序：解析 effectivePool → 拆固定/非固定并处理固定溢出 → 按 category 分组处理下溢 → 分组轮询、组内 Efraimidis–Spirakis 加权无放回抽取 → 按 `oversamplePct` 补充 → 送 prompt 前整体 shuffle（`src/core/pool-resolver.ts` 为准）。
- `cross_layer_fallback` 已删除，勿重新引入。
- 条目库 AI 生成（`PoolGenDialog`/`generatePoolEntries`）已在 v74 整体移除，勿回填；`stripTrailingCommas` 保留（parseOptions JSON 路径共用）。

## 构建与验证

```bash
pnpm build       # production 构建 → dist/（.map 本地生成、已 gitignore 不进仓库）
pnpm typecheck   # 等价 npx vue-tsc --noEmit
pnpm lint        # ESLint
pnpm test        # vitest 纯函数单测（抽取/骰子/解析/归因/卡牌约束）
pnpm i18n:check  # i18n 对账门禁（--strict 缺失或孤儿 >0 退出码 1）
pnpm format      # Prettier
npx knip         # 死代码扫描（klona/pinia/toastr 在 ignoreDependencies、ignoreExportsUsedInFile 开启，勿手动移除）
```

纯函数核心（pool-resolver/dice/option-format/option-attribution/cards-constraints）有单测兜底，改这些模块先跑 `pnpm test`；UI/行为面仍靠 typecheck/build/lint + 按改动范围浏览器验证。核心交互/UI 改动至少确认：链路可操作、窄屏不横向溢出、console 无新增 Vue/Pinia 报错。远程 action 在发布分支 production bundle 并提交 `[bot] Bundle`（map 已 gitignore，bot 不再提交）。TypeScript 锁 `6.0.0-beta`：TS7 与 vue-tsc 3.3 不兼容（ERR_PACKAGE_PATH_NOT_EXPORTED），vue-tsc 出兼容版前勿升 7。

## 分支纪律

- `main` 发布线，只从 `test` 同步源码，dist 归 bot bundle；`test` 是 bug fix 主战场；`feat/passive-status` 只做被动状态。
- 大版本 `test → main`：`git merge test --no-ff -X theirs --allow-unrelated-histories`（test 与 main 无共同祖先，不加必失败），合并后 `git restore --source=<merge 前 main sha> dist` 恢复 main 侧 dist 让 bot 重出；merge 信息带 `[release minor/patch/major]`（bundle CI 自动 bump 版本/tag，勿手改版本号）。
- 增量 bugfix 用 `git cherry-pick -n <sha>` 只搬源码，dist 冲突保留 main 侧；`feat` rebase 中 `ours` = 新 base，dist 用 main 侧。
- 同步前先查远端 main 最新提交（发布合并前 main 侧可能只有 bot 提交造成 drift）。
- **依赖更新只走 `chore/dep-updates` 分支，严禁提交 main**：酒馆的更新提示 = 「`git log HEAD..origin/main` 非空即弹」，纯依赖提交进 main 会让用户每 3 天白收更新提示，bundle 还会把未经发布验证的依赖变更打进 dist。bump_deps workflow 每 3 天把 main 的 package.json/lockfile 更新累积到该分支，发布时合进 test；分支被删时先 `git push origin origin/main:refs/heads/chore/dep-updates` 重建。

## 实现前核实的酒馆接口

- `TavernHelper`/`generateQuietPrompt`/`generateRaw` 当前签名与 `AbortSignal` 支持。
- `setExtensionPrompt`（签名 `(key, value, position, depth, scan, role, filter)`）与 `extension_prompt_types`/`extension_prompt_roles`；IN_CHAT 深度注入在文本补全与聊天补全两条路径都消费，空 value 会被 `getExtensionPrompt` 过滤。
- `#send_textarea`/`#send_but` 等 DOM id 与目标酒馆版本一致。
- `character.data.extensions` 命名空间的真实读写 API。
- `/api/characters/edit`：`json_data` 必须是角色完整卡 JSON（`ch.json_data` 快照，形如 `{spec, name, data:{...}}`），不能传 `ch.data` 子对象。
- 锁定版 `@vueuse/core ^13.9.0` 的 `useElementSize`/`onLongPress` 签名与触摸滚动边界。
