# choice（异步行动选项）

SillyTavern 扩展：独立调 API 异步生成行动选项，玩家点选后填入或发送。TS + Vue 3 SFC + Pinia + Zod + Vite，产物 `dist/`。

## 约定

- 中文回复；注释只解释「为什么」。
- **用户当前的 UI 示例/设计方向/口头指示优先级最高**，可整体换版式，但不破坏功能语义。
- `@sillytavern/...` 签名先核实源码或 TavernHelper 类型，不凭记忆。
- agent 只跑一次性 `build`/`typecheck`/`lint`；`pnpm watch` 留给用户。收尾同步本文件；UI 改动需浏览器验证。

## 技术边界

- 禁 jQuery/手写 DOM、Tailwind/UnoCSS 运行时；拖拽用现有 `sortablejs` 封装。
- 设置只经 `useXxxStore()`；组件不直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`。
- 版本敏感酒馆 API 只在 `src/core/`、`src/store/`、`src/index.ts`；例外放行 `uuidv4`、`util/character-bindings.ts`、`util/option-action.ts`。
- **角色绑定**：入口只写内存 + `setBinding()`，落盘只靠 character-settings deep watch。勿重复 `persistCharacter`（卡顿）；勿用 `saveCharacterDebounced` 存扩展字段（旧 json_data 覆盖→绑定失效）。

## 提示词

- `prompt_source` 双轨：`extension`（默认，本扩展模块管线）/ `st_preset`（完全用酒馆 CC 预设，不读本扩展模块，勿混用）。
- 预设模式**自读预设 + 自组装**，不劫持宿主生成管线（`Generate` 占全局 abortController 与发送按钮）。链路：`st-preset-source` → `preset-extract`（白名单）→ `preset-messages`（按 order 展开，8 个 marker 槽位运行时填充）→ `preset-task`（内置固定任务，不读 `prompt_rules.modules`；`renderBaiBaiSummaryContent` 是摘要包装单一来源）→ `buildPresetModeMessages`。
- 预设模式隐藏提示词配置/模块列表（配置保留），上下文设置（轮数/柏宝书/数据库）两模式共用。
- 柏宝书摘要 depth = 历史条数；`getHistory({ before: historyWindowStart })` 取 `[0,N)`，与正文零重复。本体走 `setExtensionPrompt`，副 API 直连看不到。
- `st_preset_overrides` 覆盖层（键 = identifier，不改预设文件）：`disabled` 优先于 `enabled`；`content` 替换；`content: ''` 明确清空。**两趟展开（含 in-chat 注入）都要应用**，8 个 marker 槽位不受影响。
- **提取白名单**：预设顶层混有 `reverse_proxy`/`proxy_password` 等凭据，只取条目 + 顺序表 + `PRESET_SAMPLING_KEYS`，勿整体展开进请求体；`tests/preset-extract.test.ts` 锁定。
- 采样：`st_preset_sampling` 只覆盖 temperature/top_p/惩罚项/max_tokens（实名 `openai_max_tokens`）；连接层始终用副 API。后处理 `st_preset_post_processing` 由服务端按请求体字段执行。
- 脚本层 `st_preset_script_processing`（默认 off）：`prompt_ready` 广播 `CHAT_COMPLETION_PROMPT_READY`，`tavern_helper` 走 `generateRaw`。**脚本正文绝不进快照或请求体**。
- 模块管线：`order/enabled/enrich_only`；`enrich` 必须在 assistant 模块之前。
- 静态规则（不靠配置）：防全知（已知≠熟练、获取从严、去主角化）、防媚主/极端化、开头句式错开；难度只认剧情已展示的本领，措辞用「主体」勿写死 user。

## 知识边界（默认开）

- 独立分析请求：读 persona + 世界书 + 角色卡 + 同一份 `buildChatHistory` 窗口，判定 `{{user}}` 三态（known/uncertain/unknown），口径与 `knowledge_boundary` 模块一致（获取过程从严、他人内心不可断言）。
- **增量维护**：请求带 `<existing_knowledge_table>`，模型只输出变化条目（同 topic 覆盖、`drop: true` 删除），由 `mergeKnowledgePatch` 合并进旧表。`parseKnowledgePatch` 返回 `null`=不可解析、`[]`=合法无变化，两者都必须保留旧表，语义不可混。`重建整表` 是唯一全量重跑入口（`rebuild=true` 传空表）。
- 报告存聊天级 `ChatSettings.knowledge_report`（随聊天落盘，切聊天自动切报告）；`based_on_message` 只用于过期提示与自动重跑判定，楼层数变动（含删除）都算过期。
- 存储上限 `MAX_STORED_ENTRIES=60`，超出丢 `updated_at_message` 最小的（最久未被刷新），不丢最新的。
- 注入在 `generateOptions` 的 `runWIExclWindow` 之后、`appendRuntimeLine` 之前——**扩展模式与预设模式共用同一注入点**（预设不读 modules，只有运行时注入能覆盖）。报告为空时零变化。
- 注入块插在末条 user 之前，**按总条数 `MAX_INJECT_ENTRIES=24` 裁剪**（不按状态分桶：存疑/未知天然就少，分桶配额会白白浪费），超限按「未知 > 存疑 > 已知」优先保留；再叠加 2500 字符预算，超出标注省略。宏必须在代码里 `substituteParams`——酒馆后端不替换请求体里的宏。`lastBuildMessages` 覆盖为注入后形态供调试页核对。
- 自动刷新与选项生成**并行**（`MESSAGE_RECEIVED` 里 fire-and-forget），本轮用旧报告、下一轮用新报告；不 await 是因为 ST 的 `eventSource.emit` 串行 await 监听器。
- 切聊天守卫：请求前快照 `getCurrentChatId()`，返回后不一致直接丢弃结果。
- 纯函数在 `knowledge-report.ts`（`tests/knowledge-report.test.ts` 锁定解析/合并/渲染/注入），请求层在 `knowledge-analysis.ts`。

## 生成链路

- WI 临时改写一律走 `generator.runWIExclWindow`（save/restore 全局状态，构建完即还原）；`persist-gate.ts` 窗口期推迟自身持久化，否则空绑定落盘。
- 结果写 `message.extra['choice']`，按 `swipe_id` 分层；`generations[]+currentIndex` 翻页，润色另用 `enrichGenerations`。
- 条目池：`master_pool` 是唯一内容源，`configs[]` 只引用/覆盖 `enabled/pinned/weight`；选择覆盖式 `chat > character > default`，不合并。`PoolConfig.rules` 内联在 `{{pool_selected}}` 末尾。抽取以 `pool-resolver.ts` 为准；`cross_layer_fallback` 已删。
- 输出：`<options>` 内 JSON `{"title":"标题|档位|需求值","content":"正文"}`，失败回退 `[标题]内容`；解析在 `option-parse.ts`（有单测）。
- **提取起点自后向前逐区间试**（`collectOptionRegions`）：取第一个开标签或兜底首个候选会退化成伪选项。括号回退两道闸门：`isPlausibleBracketTitle` + `isOptionAnchor`（行首或「…：」后）。
- 条目库 AI 生成：`POOL_GEN_SYSTEM_PROMPT` 写死；`parsePoolGenItems` 与 `parseOptions` 刻意分离，勿合并。

## 骰子（默认关）

- 标题 `[标题|档位|需求]`，未标按档位兜底（DND 35/60/85，COC 65/40/15）。D100：≥96 大成功、≤5 大失败、≥需求成功；点数越大越好。
- 开关：`low_roll`（反向）、`attr_dc_enabled`（刻度自适应）、`allow_formula`、`reroll_enabled`；方向集中在 `dice.ts`。
- 注释（`buildDiceMarker`）三段：固定头部（**margin 必传**）+ 模板正文 + `DICE_MARKER_TAIL`。程度用 `degreeBucket` 单一入口按空间占比切档。
- 注释经 `stagePendingTurn` 在 MESSAGE_SENT 回写进消息，输入框/聊天不可见、随消息持久化；失败保留、CHAT_CHANGED 清空。
- 正文 AI 注入只有 `dice-contract.ts`（常驻契约 + 回写），新增注入必须进此文件。`low_roll` 时追加 COC 语义教学行。
- 需求徽标/判定 chip 主面板与悬浮球各自实现，改动两处同步；徽标语义色 `rateClass` 按判定方向分档（low 镜像）。

## 统计（默认关）

- 只计选项视图，关 = 零写入；按生效 `config.id` 分桶（无 config = `'__none__'`）。
- 命中 = 生成时写 `matchedEntryId`；本地匹配 type 前缀优先 → Dice ≥0.25 且最优-次优差 ≥`OPTION_MATCH_MARGIN`(0.05)，平票归 null；前缀要求最长命中 type 唯一。
- 期望 = 采纳感知基线 + 平均点选数超几何校正（`AVG_PICKS_MIN_ROUNDS` 起效）；`recent` FIFO 50。

## UI

- `--choice-primary` 蓝系卡片化，移动端优先（~380px）。
- 选项行样式（`.choice-option-*`/`.choice-roll-chip`）只在 global.css；悬浮球独立版式但复用解析/行为层。
- `setEntryVisible` 拒绝关闭最后一个入口。z 序：panel 10 / floating 30000 / dialog 30100 / dropdown 30200 / popover 30300。
- i18n：中文源串做键；改文案跑 `pnpm i18n:check`；插值勿嵌反引号模板。
- 引导单一来源 `guide-content.ts`；唯一 `v-html` 在 `OnboardingWizard`（静态内容）。

## 目录

`src/core/`（生成/解析/骰子/预设/桥接/知识边界）、`src/store/`（schema 唯一来源 `src/type/settings.ts`，SCHEMA_VERSION 81）、`src/components/`（主面板/Floating*/编辑器）、`src/util/`、`tests/`（纯函数单测）、`tools/`。

## 构建

```bash
pnpm build      # → dist/index.js + dist/index.css
pnpm typecheck  # vue-tsc --noEmit
pnpm lint
pnpm test       # vitest 纯函数单测
pnpm i18n:check # 缺失/孤儿键门禁
pnpm format
npx knip        # klona/pinia/toastr 在 ignoreDependencies
```

纯函数核心（pool-resolver/dice/option-format/option-attribution）改前先 `pnpm test`。TS 锁 `6.0.0-beta`（TS7 与 vue-tsc 3.3 不兼容）。

## 分支

- `main` 发布线（dist 归 bot bundle），`test` 是主战场。
- 大版本：`git merge test --no-ff -X theirs --allow-unrelated-histories`，之后 `git restore --source=<旧 main sha> dist`；信息带 `[release ...]`。
- bugfix：`cherry-pick -n`，dist 保留 main 侧。
- **依赖更新只走 `chore/dep-updates`，严禁提交 main**（否则用户白收更新提示）。

## 已移除（勿回填）

卡牌（v77）、自动化（v78）、金手指桥接、`option_style`（v76）、骰子回合槽。重做先出计划。

- 迁移块不能删：zod strip 的键会残留落盘，必须显式 `delete`；新块先 grep 版本号（v79 已占用）。
- `cardSettled` 字段名保留（现只做骰子防重），改名会让旧消息失效。

## 已核实接口

- `generateQuietPrompt`/`Generate` 不采用（无 signal、占全局 abort、emit 生成事件）。
- `getPresetSettings()` 对 openai 返回空对象；读内容用 `getCompletionPresetByName`，先 `getAllPresets()` 预检。
- `setExtensionPrompt(key, value, position, depth, scan, role, filter)`；空 value 被过滤。
- `/api/characters/edit` 的 `json_data` 必须是完整卡 JSON。
