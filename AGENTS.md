# choice（异步行动选项）— 项目说明

SillyTavern 第三方扩展，基于 `tavern_extension_template`
二次开发。核心功能：单独调用 API 异步生成行动选项，供玩家点选后填入或发送。技术栈为 TypeScript + Vue 3 SFC + Pinia +
Zod + Vite；发布产物是 `dist/index.js` 与 `dist/index.css`，production 构建还会生成
`dist/index.js.map`。扩展会随仓库安装到酒馆真实扩展目录后加载。

## 与我协作时的约定

- 回复用中文。
- **每次改动都要检查本文件（AGENTS.md）并在改动完成时同步更新**：任何会影响架构、目录结构、导出面、持久化格式、UI 状态机或验证/环境约定的改动，落实后要顺手把对应条目从“待办/规划”改成“现状”（或反之），防止文档随项目漂移——本文档先前就曾因为未同步积累了大量事实性错误。改动收尾前自查一遍：新引入的模块/字段/命令是否已写进目录或约束小节；已删除的功能是否仍被当“现状”描述。不要把等待实现的设计目标误写成已实现。
- 代码注释使用简体中文、简洁，解释“为什么”而不是“做什么”；覆盖规则、抽取算法、UI 状态机等容易被简化写错的地方，注释必须说明不能直接简化的原因。
- 任何来自 `@sillytavern/...` 的导入，函数签名和导出名都不允许凭记忆假设。实现前必须去当前 clone 的真实酒馆源码或
  `TavernHelper` 类型定义核实，并把核实结论写进必要的代码注释，方便酒馆升级后复查。
- `pnpm watch`
  由用户在独立终端运行（`vite build --watch --mode development`，不是 HMR，只是自动重打包）；agent 不要自行运行常驻 watch。agent 使用一次性的
  `pnpm build`、`npx vue-tsc --noEmit`、`pnpm lint` 等命令自查。watch 编译完成后还要手动刷新酒馆页面才会加载新产物。
- 核心交互链路或 UI 改动需要实际浏览器验证；文案、样式微调、纯逻辑且不影响 UI 的小改动可由用户决定是否验证。需要验证时，说明在浏览器中的具体操作步骤，并检查 console。

## 关键架构约束

- **技术栈边界**：使用 TypeScript、Vue 3 SFC、Pinia、Zod 和原生 CSS custom property。不引入 jQuery 或手写 DOM 结构（例如
  `document.createElement`、拼接 `.innerHTML`）。拖拽排序统一使用现有的 `sortablejs` 封装（`src/util/sortable.ts` +
  `shared/DragHandle.vue`）。不引入 Tailwind/UnoCSS 等原子化 CSS 框架；仓库虽有 `tailwindcss` 与
  `eslint-plugin-better-tailwindcss` 开发依赖，但 Vite 未接入 PostCSS，CSS 入口也没有
  `@import "tailwindcss"`，不要把它们接入运行时样式。
- **设置一律走 Pinia store**：组件不直接读写 `extension_settings`、`chat_metadata` 或
  `character.data.extensions`；通过对应的 `useXxxStore()` 读写。与酒馆状态同步的实现集中在 `src/store/`。
- **酒馆 API 导入边界**：`src/core/` 与 `src/store/`
  是版本敏感酒馆 API 的主要隔离区。现有组件仍保留少量已核实且必要的稳定导入（例如
  `uuidv4`、发送框或世界书相关调用），不要为了追求形式上的“零导入”而凭空改造接口；新增版本敏感的生成、世界书、正则引擎 API 时优先收敛到 core/store，并先核实真实签名。
- **第三方桥接必须可选**：不能把 TavernHelper 或第三方插件内部数据结构当作柏宝书、数据库等插件的硬依赖。`baibai-bridge.ts`、`ejs-bridge.ts`、`shujuku-bridge.ts`
  等桥接模块必须检测能力，不可用时主体功能仍可用。
- **提示词组装必须走角色结构**，不能把整段内容拼成单条 user 消息：
  - `system`/`systemPrompt` 放提示词编辑区的规则（人称、格式、字数等）。
  - `user`/`prompt` 放抽中的固定/随机条目素材和按上下文模式截取的内容。
  - 可选 `assistant`/`prefill` 放输出格式起手式。
  - 优先使用已核实签名的 `TavernHelper` 或酒馆原生生成接口的角色消息结构；不要凭记忆假设
    `generateRaw`、`generateQuietPrompt` 或 `AbortSignal` 参数。
- **条目池是 `master_pool + PoolConfig` 两层结构**：
  - `master_pool` 是全局唯一内容真相源，保存 `id/type/content/rule/category` 以及默认 `pinned/weight`。
  - `configs[]` 是配置层，决定引用哪些条目，并可覆盖 `enabled/pinned/weight` 等配置项；配置不持有条目正文。
  - config 选择是覆盖式：`chat.config_id > character.config_id > default`，命中后只使用该 config，不合并多个 config 的 entries。
  - `effectivePool` 是 master_pool 中被选中的条目叠加配置覆盖后的结果。内容、类型、规则和分类必须从 master_pool 读取。
  - 常见 footgun：合并多个 config；从 config 读取 content；忽略
    `PoolConfigEntry.enabled`；把全局抽取参数误放回单条 config。
- **提示词配置同样覆盖式选择**：`prompt_config_id` 遵循 `chat > character > default`，不要假设提示词配置全局唯一。运行时工作副本
  （`prompt_rules.modules`，生成链路的实际输入）在用户尚未在提示词页做过配置切换/加载（`promptEditConfigId` 为空）时自动跟随生效配置
  （`global-settings.ts` 的 `syncEffectivePromptConfigToWorkCopy`）；模块编辑经深度 watch 即时回写当前归属配置快照，避免
  「编辑→刷新→切配置」场景的快照覆盖丢失。
- **楼层持久化挂在消息对象上**：结果写入对应 AI 消息的 `message.extra['choice']`，再按 `swipe_id`
  分层，避免切楼层或切 swipe 时串历史。同一楼层多次生成使用 `generations[] + currentIndex` 翻页；润色结果另有
  `enrichGenerations` / `enrichCurrentIndex`。
- **生成模块是可排序、可启停的管线**：`prompt_rules.modules` 通过 `order`、`enabled`、`enrich_only`
  控制模块顺序和参与方式。上下文通过 `context_mode`
  等设置决定读取范围，不再维护“聊天内模式 / 全局模式”两套生成模式的说法。`enrich`
  模块必须排在 assistant 相关模块之前；人称和字数可配置，当前默认选项/润色范围为 10–60 个字符，不要把它写死成第三人称或 30–80 字。

## UI 设计系统与约定

### 已落地的设计原则

- 不更换主色调；`--choice-primary` 蓝色系和 `ActionOptionsPanel.vue` 的整体视觉作为基准，只做细节打磨。
- 移动端优先：新组件先在约 380px 容器宽度验证，再扩展到桌面宽度。
- 使用克制的卡片化和明确的信息层级，不做玻璃拟态或强动效。
- `src/theme.css` 已包含颜色、间距、字号、圆角、阴影、层级和状态色 token。间距使用
  `--choice-space-1`~`--choice-space-6`，字号使用 `--choice-text-xs/sm/base/lg/xl`，新增样式不要继续散落裸值。
- 当前层级 token 的实际值为：`--choice-z-panel: 10`、`--choice-z-floating: 30000`、`--choice-z-dialog: 30100`、`--choice-z-dropdown: 30200`、`--choice-z-popover: 30300`。不要恢复硬编码 z-index。

### Shared 组件现状与待办

`src/components/shared/` 已有
`ChoiceSection.vue`、`ChoiceCard.vue`、`ChoiceField.vue`、`ChoiceDialog.vue`、`ChoiceSwitch.vue`、`DragHandle.vue`、`ImportSourceDialog.vue`、`tab-definitions.ts`、`useCompactLayout.ts`。其中
`useCompactLayout` 使用 `@vueuse/core` 的 `useElementSize`，断点为 420px；不要用 CSS `@container`
替代，因为部分移动 WebView 可能静默忽略该规则。

目前只有 `ChoiceDialog` 在提示词导入等少数位置使用，`ChoiceSection`、`ChoiceCard`、`ChoiceField`
仍是预备的设计系统组件，不能在文档中当作已经完成全量迁移。其余弹窗仍可能保留独立 overlay/header/footer 样式；迁移时要逐个验证遮罩关闭、Escape 关闭、动画和窄屏布局，不要一次性假设全部组件已经统一。

### 悬浮球实际状态

`FloatingBubble.vue` 当前实现的互斥状态是 `Disabled > Generating > Dragging > Idle`：

- Disabled：API 解析失败或 `effectivePool` 为空。
- Generating：`generatorState.loading === true`。
- Dragging：拖动期间展示拖拽态。
- Idle：默认态；已经实现贴边吸附和边界钳制。

右键菜单是当前快捷菜单入口；尚未实现基于 `onLongPress`
的长按状态机。`hasUnseenResult`、未读结果徽章和快速预览 popover 尚未接入；`ActionOptionsPanel.vue` 虽已有
`compact?: boolean` 预埋能力，但当前没有完整的悬浮球 popover 调用方。新增这些能力时，必须复用 `ActionOptionsPanel`
的选项选择与 behavior 逻辑，不要复制一套渲染逻辑。

### 面板工具区与魔棒菜单入口

- `ActionOptionsPanel.vue` 标题栏工具区右起为 [生成/润色][锁定][主题循环][设置]：设置按钮复用
  `openSettings`（`floating-state.ts`），与悬浮球/魔棒菜单共用同一开关。
- `wand-menu.ts` 向酒馆输入框左侧的 `#extensionsMenu`
  注入「行动选项」入口，点击打开设置面板。`ui.wand_menu_enabled`（AppearanceSettings「面板」分区开关，默认
  `true`，schema `src/type/settings.ts`）控制该入口显隐，通过全局设置 `$subscribe`
  即时同步；该开关只影响魔棒入口，不联动 `floating_enabled`、不影响选项面板/悬浮窗。

## 目录与职责（按当前源码，不把早期规划稿当标准）

- `src/core/`：`generator.ts`（结构化 role
  prompt、选项/条目池生成、取消、API 解析）、`pool-resolver.ts`（effectivePool 的分组加权抽取纯函数）、`option-dedup.ts`（候选选项去重）、`options-store.ts`（消息 extra、swipe、翻页和润色结果）、`floating-state.ts`、`enrich-input.ts`、`api-client.ts`、`panel-mount.ts`、`theme-detector.ts`、`theme-presets.ts`、`wand-menu.ts`、`onboarding.ts`、`guide-content.ts`，以及
  `baibai-bridge.ts`、`ejs-bridge.ts`、`shujuku-bridge.ts`、`st-character.ts`、`st-regex-source.ts`
  等可选桥接和酒馆数据适配模块。
- `src/store/`：`global-settings.ts`、`character-settings.ts`、`chat-settings.ts`、`pool-selector.ts`、`prompt-config-selector.ts`、`panel-state.ts`。设置 schema 的唯一来源是
  `src/type/settings.ts`，当前 `SCHEMA_VERSION` 为 46。
- `src/components/`：主面板 `ActionOptionsPanel.vue`；悬浮形态
  `FloatingBubble.vue`、`FloatingRoot.vue`、`FloatingSettings.vue`、`FloatingContextMenu.vue`；8 个设置 tab：`PoolEditor.vue`、`GenerationSettings.vue`、`PromptEditor.vue`、`ApiEditor.vue`、`WorldInfoEditor.vue`、`FilterEditor.vue`、`AppearanceSettings.vue`、`DebugSettings.vue`；条目池和导入相关组件：`EntryPoolDialog.vue`、`PoolGenDialog.vue`、`SelectEntriesDialog.vue`、`ImportPoolDialog.vue`、`PromptImportDialog.vue`、`StRegexImportDialog.vue`、`FilterGroupPanel.vue`；引导相关组件：`OnboardingWizard.vue`、`WelcomeCard.vue`、`GuidePopover.vue`；通用弹窗包括
  `ConfirmDialog.vue`、`CreateConfigDialog.vue`、`RegexLibraryDialog.vue`。
- `src/components/shared/`：设计系统基础组件、拖拽手柄、导入来源弹窗、tab 定义和窄屏布局 composable。
- `src/type/`：Zod schema、默认值、迁移逻辑和领域类型；不要在组件里重新定义设置结构。
- `src/util/`：文件选择、SortableJS 配置和 Zod 解析辅助。
- 根级入口包括 `src/index.ts`、`src/pinia.ts`、`src/theme.css`、`src/global.css` 和全局类型声明。

## 新手引导架构

- 内容单一来源是 `src/core/guide-content.ts`：`GUIDE_CHAPTERS`（7 章）+ `PAGE_HINTS`（8 个 tab）+
  `DIALOG_HINTS`（3 个弹窗）。组件中不要另写平行的引导文案。
- `quick-start` 是唯一默认路径（配置 API → 生成），另有条目池、生成、提示词、世界书、过滤、外观 6 个进阶章。章内使用
  `onboardingStepIndex`，当前章由 computed 解析。
- `onboarding.ts`
  负责自动打开、欢迎卡、API 配置召回、章节菜单、待处理 tab/弹窗动作等状态。自动生成路径遇 API 未配置时只提示并跳过，不抢焦点弹窗。
- 设置面板 tab 栏的 🎓 打开章节菜单，❓ 显示结构化 `PAGE_HINTS`；不要用 `v-html` 注入引导内容。
- `onboarding_done` 在欢迎卡或向导弹出时即置为 true。`data-tour`
  锚点分散在 13 个组件模板中，增删向导步骤时要同步检查锚点。
- `docs/choice-prompt-redesign-spec.md` 是当前仓库中可见的提示词设计参考；不要引用不存在的
  `async-action-options-spec.md`、`choice-ui-redesign-spec.md` 或 `choice-floating-bubble-design.md`。`docs/`
  下的方案文档是背景参考，不替代当前源码。

## 条目池模型与抽取算法

- `PoolEntry` 字段为 `id`、`type`、`content`、`rule`、`pinned`、`weight`、`category`；`pinned`/`weight` 可被
  `PoolConfigEntry` 覆盖。`rule` 是写作约束，不是选用门槛；v20 起删除
  `condition`，v21 起候选条目必须交给 AI，`[规则: xxx]` 只约束该选项如何写。
- 抽取顺序：解析 effectivePool
  → 拆分固定/非固定并处理固定条目溢出 → 按 category 分组并处理下溢 → 分组轮询、组内按 Efraimidis–Spirakis 加权无放回抽取 → 按
  `oversamplePct` 为非固定条目补充菜单候选 → 送入 prompt 前整体 shuffle。加权 key 为 `random()^(1/weight)`；具体实现以
  `src/core/pool-resolver.ts` 为准。
- `cross_layer_fallback` 已删除，不要重新引入或在新代码中保留该兼容概念。抽取默认值和 schema 以 `src/type/settings.ts`
  为准。
- 选项去重在 `src/core/option-dedup.ts` 完成，使用相似度阈值和去重报告；调试信息由 `DebugSettings.vue` 展示。

## 构建、格式化与验证

```bash
pnpm install
pnpm build             # 一次性 production 构建
npx vue-tsc --noEmit   # 类型检查
pnpm lint              # ESLint 检查
pnpm format            # Prettier 写回格式
```

当前没有 Vitest/Jest 测试脚本；验证手段是类型检查、构建、lint/format 和按改动范围进行的浏览器验证。`pnpm watch`
是常驻的 development
build，不要由 agent 启动。watch 会使用内联 sourcemap，可能覆盖本地 production 产物；这是正常的开发状态。远程 GitHub
action 会在发布分支执行 production bundle 并提交 `[bot] Bundle`，提交时不要为了 map 或 CSS 产物状态额外重跑发布流程。

浏览器验证使用当前工作区可用的浏览器自动化工具和用户已有酒馆登录态；不要在仓库文档中假定某个平台的 Chrome 启动命令、MCP 注册方式或新开无痕实例。验证 UI 时至少确认：核心交互链路可操作、窄屏不横向溢出、console 没有新增 Vue/Pinia 报错。改动悬浮球、ActionOptionsPanel、弹窗或响应式布局时，按实际改动场景逐项操作，不要把尚未实现的未读结果态列为通过条件。

## 分支纪律（防三分支选项代码漂移）

- `main` 是发布线，只从 `test` 同步源码；dist 由 bot bundle 管理。
- `test` 是行动选项 bug fix 和预发布验证主战场。
- `feat/passive-status` 只做被动状态，成熟前不合并回 main/test；定期 rebase `origin/main` 获取 bug fix。
- 行动选项 bug fix 只在 `test` 修并推送验证。
- 大版本发布（test 领先 main 较多、含多个功能批次时）：`test → main`
  用 `git merge test --no-ff -X theirs`（源码冲突一律取 test 侧），合并后 `git restore --source=<merge 前 main sha> dist`
  恢复 main 侧 dist，让 bot 重出产物；merge 提交信息带 `[release minor]`/`[release patch]`/`[release major]` 标记，
  由 bundle CI 自动 bump `manifest.json`/`package.json` 并打 tag（机制见 `.github/workflows/bundle.yaml`，不要手动改版本号）。
- 增量 bugfix 的 `test → main` 同步使用
  `git cherry-pick -n <sha>`，只搬源码不搬 dist；发生 dist 冲突时保留 main 侧 dist，让 bot 重出产物。
- `feat` rebase 时保留 main 的 fail-safe 与 feat 的被动状态；rebase 中 `ours`
  是新 base（main）一侧，dist 使用 main 侧；feat 不触发 bot bundle。
- 除 bot
  bundle 外，默认分支还有定期依赖更新 action，可能造成 main 与 test 的依赖版本漂移；同步前先检查远端 main 的最新提交。
- `--ours/--theirs` 方向：cherry-pick 中 theirs 是被 pick 的提交；rebase 中 ours 是新 base（main）。

## 实现前必须核实的酒馆接口

- `TavernHelper`、`generateQuietPrompt`、`generateRaw` 的当前签名及是否支持 `AbortSignal`。
- `#send_textarea`、`#send_but` 等发送框 DOM id 是否与目标酒馆版本一致。
- `character.data.extensions` 命名空间的真实读写 API。
- 当前 `TavernHelper` 的实际导出面，以真实源码和类型定义为准，不要根据旧文档猜函数名。
- 当前锁定版本 `@vueuse/core ^13.9.0` 中 `useElementSize`、`onLongPress`
  的签名和触摸滚动边界行为；未实现的长按方案在重新设计前不要直接照抄旧示例。
