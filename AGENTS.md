# choice（异步行动选项）— 项目说明（给 Agent）

SillyTavern 第三方扩展，基于 `tavern_extension_template` 二次开发。核心功能：单独调用API异步生成"行动选项"，供玩家点选后填入/发送；支持输入润色、世界书条目过滤、AI 条目池生成等。TypeScript + Vue 3 + Pinia + Zod + Vite 构建，产物打包为 `dist/index.js` + `dist/index.css`，随扩展clone进酒馆真实安装目录后加载。

## 与我协作时的约定

- 回复用中文。
- 代码注释：简体中文、简洁、解释"为什么"而非"做什么"——尤其是覆盖规则、抽取算法这类容易被后来者简化/写错的逻辑，注释要点出"为什么不能这样简化"。
- 任何来自 `@sillytavern/...` 的导入，函数签名/导出名不允许凭记忆假设，必须先去clone进来的真实酒馆源码里核实（或查`@types/`下的类型定义），核实方式和结论写进注释，方便复查。
- 改代码后必须 `pnpm build`，**没有热更新**——验证效果要求刷新酒馆网页。
- 每次功能验证请说明"如何在浏览器里手动确认"这一步具体怎么操作，不要只凭代码审查判断"应该没问题"。

## 关键架构约束

- **技术栈边界**：严格用 TS + Vue 3 SFC + Pinia + Zod + Tailwind CSS，不引入其他 UI 框架。
- **设置一律走 Pinia store**：组件内不允许直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`，必须经过对应的 `useXxxStore()`。
- **`@sillytavern` 导入的隔离原则**：这类导入（直接摸真实酒馆源码，不是npm包）只允许出现在 `src/core/` 和 `src/index.ts` 入口文件里，不允许散落进Vue组件——酒馆升级导致导出改名时，改动范围收窄在这几个文件。
- **禁止对第三方插件的硬依赖**：条件表达式统一走ST原生变量（`getvar`/`setvar`/`chat_metadata.variables`），不直接读取任何第三方插件内部数据结构。第三方插件桥接做成可选的、检测式的桥接模块（`src/core/baibai-bridge.ts`），不影响主体功能可用性。
- **提示词组装必须走角色结构，不允许拼成一整段字符串塞进单条user消息**：
  - `system` 消息 = 提示词编辑区设置的模块（规则、人称、格式等）
  - `user` 消息 = 抽中的固定/随机条目素材 + 按轮数截取的上下文 + 世界书内容
  - 可选 `assistant` 消息 = 预填输出格式起手式（如强制 `<options>` 开头）
  - 实际通过 `api-client.ts` 直接 fetch `/api/backends/chat-completions/generate`，传入 `messages` 数组（三态分离），绕过 ST 预设注入保证 messages 即为最终入参。
- **三层条目池是覆盖式，不是合并**：`聊天 > 角色 > 全局`，聊天层非空则本轮抽取完全忽略角色层/全局层。写抽取逻辑时最容易被简化成merge，需要专门测试这条边界。
- **楼层持久化挂在消息对象上**：生成结果存进对应AI消息的 `message.extra['asyncActionOptions']`，按 `swipe_id` 再分一层（类似swipe机制），保证切楼层/切swipe时选项历史不串。同楼层多次生成走 `generations[]` + `currentIndex` 翻页，不跨楼层保留。

## 目录结构

```
src/
├── index.ts                  # 入口：初始化 FloatingApp、WandMenu、PanelMount，监听 CHAT_CHANGED / CHARACTER_PAGE_LOADED
├── pinia.ts                  # Pinia 单例 createPinia()
├── global.css                # 酒馆全局样式覆盖（menu_button 宽度、移动端适配、滚动条）
├── theme.css                 # 主题 CSS 变量定义（面板/卡片/文字/主色调）
├── type/
│   └── settings.ts           # 所有 Zod Schema + 类型推断 + 常量（549行）：PoolEntry、PoolConfig、PromptModule、PromptRules、SecondaryApi、GlobalSettings、DEFAULT_MODULES、BAIBAI_MODULE_IDS 等
├── util/
│   └── zod.ts                # Zod 验证辅助：validateInplace（merge 回原对象）、parsePrettified
├── core/
│   ├── generator.ts          # 核心生成引擎（610行）：buildMessages 模块管线、buildWI 世界书、行动选项生成、条目池生成（generatePoolEntries）、取消支持
│   ├── pool-resolver.ts      # 纯函数抽取算法：三层覆盖解析后的条件过滤、固定/非固定拆分、溢出处理、category分组、下溢处理、Efraimidis-Spirakis加权无放回抽取、最终shuffle
│   ├── api-client.ts         # 统一 fetch 酒馆 generate 端点，绕过预设注入；支持 exclude_params 删除指定字段
│   ├── baibai-bridge.ts      # 可选桥接模块：检测式获取第三方插件数据，不依赖则返回 null
│   ├── enrich-input.ts       # 输入润色管线：复用 buildMessages 模块管线，通过 {{input}} 占位符替换，调用副 API 返回润色版本数组，支持取消
│   ├── options-store.ts      # message.extra['asyncActionOptions'] 读写封装，按 swipe_id 分层，generations[] + currentIndex 翻页
│   ├── panel-mount.ts        # 在 #chat 中挂载 ActionOptionsPanel Vue 应用，同步最新 AI 消息
│   ├── wand-menu.ts          # 注入魔法棒菜单项到 #extensionsMenu
│   ├── floating-state.ts     # 全局悬浮窗开关状态 ref
│   └── variable-bridge.ts    # 读取 ST 原生变量（优先 TavernHelper），条件表达式解析
├── store/
│   ├── global-settings.ts    # 主设置 store（706行），对应 extension_settings['choice']
│   ├── chat-settings.ts      # 对应 chat_metadata['choice']
│   ├── character-settings.ts # 对应 character.data.extensions['choice']
│   ├── pool-selector.ts      # 组合三个 store，暴露 effectiveConfig（chat > char > default）和 effectivePool
│   └── panel-state.ts        # 面板 UI 状态：当前楼层、generations、翻页索引、润色模式
└── components/
    ├── shared/
    │   └── tab-definitions.ts    # Tab 定义（INLINE_TABS / FLOATING_TABS）
    ├── ActionOptionsPanel.vue    # 主面板：选项按钮、翻页、润色模式切换、填入/发送
    ├── SettingsPanel.vue         # 扩展设置入口（inline drawer + tab 切换）
    ├── FloatingRoot.vue          # 悬浮窗根组件（FloatingSettings + FloatingBubble）
    ├── FloatingSettings.vue      # 可拖拽/可调整大小的悬浮设置对话框
    ├── FloatingBubble.vue        # 右下角悬浮快捷按钮，生成中脉冲动画
    ├── PoolEditor.vue            # 配置级条目池管理：层级筛选、条目 CRUD、分组展开、导入/AI生成入口
    ├── EntryPoolDialog.vue       # 全局条目库对话框：master_pool 展示、分组、粘贴导入、AI生成
    ├── PromptEditor.vue          # 提示词模块编辑器（1107行）：模块列表、CRUD、角色类型、enrich_only、导出导入 JSON
    ├── WorldInfoEditor.vue       # 世界书编辑器：书籍展开、条目搜索/过滤、权重调整、蓝灯/绿灯/禁用状态
    ├── ApiEditor.vue             # API 配置编辑：名称/URL/Key/Model/温度/max_tokens/stream/exclude_params
    ├── PoolGenDialog.vue         # AI 生成条目弹窗：目标配置、条目数、分组、prompt 模板、预览替换
    ├── GenerationSettings.vue    # 生成行为设置：auto_generate、click_behavior、context_mode、context_rounds
    ├── AppearanceSettings.vue    # 外观设置：悬浮窗开关、润色开关、润色版本数、面板折叠、字体大小
    ├── ImportEntriesDialog.vue   # 粘贴导入弹窗：格式自动识别（1. / - / •）、分组选择
    ├── SelectEntriesDialog.vue   # 批量选择条目弹窗：分组展示、全选/反选、搜索
    ├── CreateConfigDialog.vue    # 新建配置弹窗：名称、默认、绑定聊天/角色
    ├── ConfirmDialog.vue         # 通用确认弹窗
    ├── DebugSettings.vue         # 调试页：版本信息、schema 版本、模块数/条目数/配置数/API 数、工厂重置
    ├── PageGuide.vue             # 页面指引折叠面板
    └── GuidePopover.vue          # 指引气泡浮层

@types/                         # 酒馆类型定义（34个 .d.ts）：
  ├── iframe/                   # 沙箱 iframe 侧 API（TavernHelper、SillyTavern、变量、事件等）
  └── function/                 # 插件侧 API（角色、聊天、世界书、生成、注入等）
```

## 三层条目池 & 抽取算法

- 条目字段：`text`、`pinned`、`weight`、`category`、`condition`（表达式：`变量名 运算符 值`，如 `地点 == 医院`）。
- 配置系统：`PoolConfig` 引用 `master_pool` 中的条目（`entry_id`），可覆盖 `pinned`/`weight`/`condition`。支持多配置、默认配置、聊天/角色绑定。
- 抽取顺序：确定生效池（覆盖式）→ 条件过滤（含固定条目，默认遵守过滤，可配开关）→ 拆分固定/非固定，处理溢出（默认固定条目不砍，全发）→ 按category分组，处理下溢（默认有多少抽多少，不跨层兜底）→ 分组轮询+组内加权无放回抽取（Efraimidis-Spirakis算法：`key = random()^(1/weight)`，降序取）→ 送入prompt前整体shuffle一次（默认开启，避免固定条目位置固定造成AI顺序偏好）。

## 提示词模块系统

- `PromptModule` 支持 `system`/`user`/`assistant` 三种角色，按 `order` 排序注入。
- `enrich_only: true` 的模块仅在润色时使用，行动选项生成时忽略。
- 支持 `{{input}}` 占位符（润色时替换为用户输入）、`{{pinned}}`/`{{pool_selected}}`（条目池注入）。
- 聊天历史通过 `ChatFilterRule` 支持标签匹配（字面量头/尾）或正则过滤。
- 上下文模式 `context_mode`：`rounds`（最后N轮，含隐藏消息）和 `visible_only`（仅可见消息，不限轮数）。

## 输入润色（Enrich）

- 发送前将用户输入改写为 N 个版本（可配置数量）。
- 复用主生成管线的 `buildMessages` 模块，通过 `{{input}}` 占位符替换。
- 调用副 API（`resolveCustomApi`），独立取消机制。
- 启用 `enrich_only` 模块仅在润色时注入。

## 世界书处理

- 使用 ST 原生 `getWorldInfoPrompt` 获取世界书内容。
- 聊天级可排除书籍/条目、启用指定书籍。
- 蓝灯（常驻始终注入）、绿灯（关键词触发匹配时才注入）、禁用（跳过）三种状态。
- 全局设置中可开关世界书注入。

## 构建与验证

```bash
pnpm install
pnpm build          # 一次性打包，验证TS类型和构建是否通过
npx vue-tsc --noEmit # 单独跑类型检查
```

**`pnpm watch` 由我在独立终端里全程跑着**，不需要agent自己调用——`watch`是常驻进程不会退出。agent只需要用一次性的`pnpm build`（或`vue-tsc --noEmit`）自查有没有类型/编译错误。

因为`watch`已经在跑，代码改完会自动重新打包，**但浏览器仍然需要手动刷新**才能看到效果（无热更新）。如需实际点击/交互验证，优先用浏览器自动化工具（Playwright类MCP）打开本地酒馆实例操作并自行刷新页面。

## 已知需要在实现时核实、不要凭记忆假设的点

- `#send_textarea` / `#send_but` 等发送框DOM id 是否与实际安装的酒馆版本一致。
- `character.data.extensions` 命名空间的读写API在目标版本的确切调用方式。
- `TavernHelper`当前版本实际暴露了哪些变量/消息/生成相关接口，以其类型定义（`@types/`）为准，不要以文档描述的能力范围直接猜函数名。
- 世界书 `getWorldInfoPrompt` 的返回格式和参数签名是否与当前酒馆版本一致。