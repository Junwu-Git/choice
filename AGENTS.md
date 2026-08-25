# choice（异步行动选项）— 项目说明（给 Agent）

SillyTavern 第三方扩展，基于 `tavern_extension_template` 二次开发。核心功能：单独调用API异步生成"行动选项"，供玩家点选后填入/发送。TypeScript + Vue 3 + Pinia + Zod + Vite 构建，产物打包为单文件 `dist/index.js`，随扩展clone进酒馆真实安装目录后加载。

## 与我协作时的约定

- 回复用中文。
- 代码注释：简体中文、简洁、解释"为什么"而非"做什么"——尤其是覆盖规则、抽取算法、UI 状态机这类容易被后来者简化/写错的逻辑，注释要点出"为什么不能这样简化"。
- 任何来自 `@sillytavern/...` 的导入，函数签名/导出名不允许凭记忆假设，必须先去clone进来的真实酒馆源码里核实（或查`TavernHelper`类型定义），核实方式和结论写进注释，方便复查。
- 改代码后必须 `pnpm build`，**没有热更新**——验证效果要求刷新酒馆网页，不要假设改完代码就能立刻在浏览器里看到变化。
- 每次功能验证请说明"如何在浏览器里手动确认"这一步具体怎么操作，不要只凭代码审查判断"应该没问题"。

## 关键架构约束

- **技术栈边界**：严格用 TS + Vue 3 SFC + Pinia + Zod，不允许手写jQuery/直接DOM操作（`document.createElement`、`.innerHTML`拼接这类）。参考模板自带的Vue+Pinia+Zod示例风格。不引入 Tailwind/UnoCSS 等原子化 CSS 框架（会和酒馆页面自身样式冲突，`tailwind.config.js` 虽在仓库里但当前样式方案不依赖它，改动前先确认这条约束是否仍成立）。
- **设置一律走 Pinia store**：组件内不允许直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`，必须经过对应的 `useXxxStore()`。
- **`@sillytavern` 导入的隔离原则**：这类导入（直接摸真实酒馆源码，不是npm包）只允许出现在 `src/core/` 下的文件里，不允许散落进Vue组件——酒馆升级导致导出改名时，改动范围收窄在这几个文件。
- **禁止把TavernHelper/酒馆变量系统当作对第三方插件（柏宝书等）的硬依赖**：条件表达式统一走ST原生变量（`getvar`/`setvar`/`chat_metadata.variables`），不直接读取任何第三方插件内部数据结构。后续如需联动柏宝书摘要/总结，做成可选的、检测式的桥接模块，不影响主体功能可用性。
- **提示词组装必须走角色结构，不允许拼成一整段字符串塞进单条user消息**：
  - `system`（或`systemPrompt`）＝ 提示词编辑区设置的规则（第几人称、格式、字数等）
  - `user`（或`prompt`）＝ 抽中的固定/随机条目素材 + 按轮数截取的上下文
  - 可选 `assistant`（`prefill`）＝ 预填输出格式起手式（比如强制"- "开头）
  - 优先用 `TavernHelper` 的 `generate`/`generateRaw`（`RolePrompt[]` / `overrides` / `injects`），或酒馆原生 `generateRaw({systemPrompt, prompt, prefill})`；不允许自己拼一整段字符串再整体当prompt参数传。
- **三层条目池是覆盖式，不是合并**：`聊天 > 角色 > 全局`，聊天层非空则本轮抽取完全忽略角色层/全局层。写抽取逻辑时最容易被简化成merge，需要专门测试这条边界。
- **楼层持久化挂在消息对象上**：生成结果存进对应AI消息的 `message.extra['asyncActionOptions']`，按 `swipe_id` 再分一层（类似swipe机制），保证切楼层/切swipe时选项历史不串。同楼层多次生成走 `generations[]` + `currentIndex` 翻页，不跨楼层保留。

## UI 设计系统与约定

当前 UI 正在做系统性翻新（原因：`theme.css` 只有颜色 token，没有间距/字号体系，各组件各写各的 padding；`EntryPoolDialog.vue`/`PoolEditor.vue`/`PromptEditor.vue` 这类信息密集页面一行塞多个控件、头部堆多个纯图标按钮，是"混乱"感的主要来源）。以下是已确认的方向，改 UI 相关代码前先看这节，避免和已定方案冲突。

### 设计原则
- 不换主色调（`--choice-primary` 蓝色系已验证可用，`ActionOptionsPanel.vue` 是现有代码里视觉完成度最高的部分，只做细节打磨，不大改）。
- 移动端优先：SillyTavern 大量用户在手机上用，任何新组件先在 ~380px 容器宽度下验证不错位，再扩展到桌面宽度。
- 克制的卡片化 + 明确信息层级，不做玻璃拟态/强动效这类花哨效果。

### 设计 token（扩展 `theme.css`，两套主题都要覆盖）
在现有颜色/圆角/阴影变量基础上补充：
- 间距：`--choice-space-1`~`--choice-space-6`（4px 基准网格：4/8/12/16/24/32px），替代所有随手写的 `padding`/`gap` 数值。
- 字号：`--choice-text-xs/sm/base/lg/xl`，基于现有 `--choice-font-scale` 缩放，语义化命名替代裸 `font-size: 13px` 这类写法。
- 层级：`--choice-z-panel`(10) / `--choice-z-dropdown`(100) / `--choice-z-dialog`(1000) / `--choice-z-floating`(9000) / `--choice-z-popover`(9500)，统一现在各处硬编码的 `z-index`（悬浮球现是硬编码 9999，需迁移）。

改造验收标准：全仓库搜索裸 `padding: \d+px` / `gap: \d+px` / `font-size: \d+px`（未经过 `--choice-` 变量的），替换为对应 token。

### 共享基础组件（`src/components/shared/`，新增）
目前 `shared/` 只有 `tab-definitions.ts`，各组件手写 div 拼卡片/弹窗，导致改一处不一致。新增以下 4 个纯展示组件，**新写的 UI 一律基于它们，不允许再裸写卡片/弹窗结构**：
- `ChoiceSection.vue` — 分段容器，带标题+可选折叠。
- `ChoiceCard.vue` — 列表行卡片，摘要行与操作/详情行分离（不像 `EntryPoolDialog.vue` 现在那样一行塞 6 个控件），slots：`#summary` `#badges` `#actions` `#details`。
- `ChoiceField.vue` — 表单字段行，统一 label+input 间距对齐；窄容器下 row→stack 自动切换（见下方"响应式布局"，不用 CSS container query）。
- `ChoiceDialog.vue` — 弹窗外壳，统一 `ConfirmDialog`/`CreateConfigDialog`/`SelectEntriesDialog`/`ImportEntriesDialog`/`PoolGenDialog`/`EntryPoolDialog`/`FloatingSettings` 这些现在各自实现一遍 overlay/header/footer 的弹窗。

迁移完成的验收标准：上述弹窗组件各自文件里不应再出现独立的 overlay/header scoped CSS。

### 响应式布局：用 ResizeObserver，不用 `@container`
**已确认结论，不要用 CSS container query 重新实现。** 原因：SillyTavern 是自建服务，插件方无法控制用户用什么内核打开——国内常见的微信内置浏览器/UC/QQ浏览器/部分安卓 ROM 系统 WebView 内核经常滞后于标准 Chromium，`@container` 一旦不支持是**静默失效**（规则整条被忽略、不报错），不会被察觉，反而制造新的"某些用户觉得插件显示乱"的问题。改用 `@vueuse/core`（已是仓库依赖，`FloatingBubble.vue` 已在用它的 `useDraggable`/`useStorage`）的 `useElementSize`：

```ts
// src/components/shared/useCompactLayout.ts
import { useElementSize } from '@vueuse/core';
const COMPACT_BREAKPOINT = 420;
export function useCompactLayout(target: Ref<HTMLElement | null>) {
  const { width } = useElementSize(target);
  const isCompact = computed(() => width.value > 0 && width.value < COMPACT_BREAKPOINT);
  return { isCompact };
}
```
`ChoiceField.vue` 用它给根节点绑 `is-compact` class，CSS 侧写两套规则，不依赖浏览器能力检测。

### 悬浮球（`FloatingBubble.vue`）状态机
现状只有默认态和生成中脉冲两种视觉状态，点击永远打开设置弹窗。改造成状态指示器，状态互斥展示，优先级：`Disabled > Generating > 有新结果待查看 > Dragging > Idle`。

- **Idle**：贴边半隐藏，极慢速呼吸光晕（8s 周期，与 generating 的 3s 脉冲区分开，两套独立 keyframes）。
- **Generating**：`generatorState.loading === true`，沿用现有脉冲动画。
- **有新结果待查看**（新增状态）：`computed hasUnseenResult` = 最近一次 generation 完成时间戳 > 用户上次打开悬浮面板/点击气泡的时间戳。徽章弹入动效（`scale(0)→scale(1)`，`cubic-bezier(0.34, 1.56, 0.64, 1)`）。
- **Disabled**：判断标准直接复用 `generator.ts` 里已有的校验，不新写逻辑——`resolveCustomApi(gs.settings.active_api_id, gs.settings.apis)` 解析不到（对应现有报错"请先在设置中配置 API"），**或** `usePoolSelectorStore().effectivePool` 为空数组，两者任一为真即 Disabled。

交互：
- 点击：有未读结果时优先展开"最近一次生成结果的快速预览"popover；无未读结果时行为不变（打开设置）。
- 长按（>500ms，用 VueUse 的 `onLongPress`，不手写 `pointerdown`/`setTimeout`）：呼出快捷菜单，"打开设置"/"隐藏悬浮球"。**"隐藏悬浮球"是永久关闭，写入 setting 持久化（等价于设置里悬浮球开关关掉），不是临时隐藏——否则用户刷新后没地方再打开它。**
- 拖拽松手自动吸附最近屏幕边缘（现在只是 `clamp` 到边界内，不吸附），吸附/生成动画用带回弹感的 easing。

快速预览 popover 的实现原则：**复用 `ActionOptionsPanel.vue`，不新写一遍选项渲染/选择逻辑**（`onSelect`、behavior 切换、`sendTextareaMessage` 注入这些是核心交互，两处实现会有维护同步风险）。给它加一个 `compact?: boolean` prop，隐藏翻页器/重新生成/收起这些面板管理控件，只留选项列表 + behavior 切换条。新写的只是 popover 定位外壳（锚定悬浮球坐标、viewport clamp、点击外部关闭），不碰选项逻辑。`FloatingSettings.vue` 打开/关闭动画的 `transform-origin` 对准悬浮球坐标（从球体"生长"出来的空间关联感）。

### 分优先级翻新顺序
P0（低风险高可见度，先做）：`ActionOptionsPanel.vue` 细节打磨（token化 padding、loading 骨架屏）、悬浮球状态机改造、`FloatingSettings.vue` 迁移到 `ChoiceDialog`。
P1（用户反馈"混乱"的主要来源）：`EntryPoolDialog.vue` → `PoolEditor.vue` → `PromptEditor.vue`，逐个用 `ChoiceCard`/`ChoiceSection`/`ChoiceField` 重写，每个都有拖拽排序/展开状态等交互逻辑，重构 CSS 时容易连带破坏 JS 行为，替换完一个要跑一次 `pnpm build` + 手动过一遍交互再进行下一个。
P2：其余小型 Dialog 迁移 `ChoiceDialog`、`SettingsPanel.vue` tab 栏窄屏改横向滚动。

## 目录（按实际文件结构，注意与早期规划稿的差异）

- `src/core/` — `generator.ts`（单独调用API生成选项/条目池，结构化role prompt，支持取消，含 `resolveCustomApi` API 校验）、`pool-resolver.ts`（三层覆盖解析+条件过滤+分组加权抽取，纯函数）、`options-store.ts`（`message.extra`存取，含swipe维度、翻页）、`floating-state.ts`（悬浮球/悬浮面板共享状态）、`enrich-input.ts`（输入润色模式）。
- `src/store/` — `global-settings.ts`（对应`extension_settings`）、`character-settings.ts`（对应角色卡`data.extensions`）、`chat-settings.ts`（对应`chat_metadata`）、`pool-selector.ts`（组合三个store，暴露覆盖解析后的`effectivePool`/`effectiveConfig`）、`panel-state.ts`（面板展开/折叠、当前楼层/swipe追踪）。
- `src/components/` — 主形态 `ActionOptionsPanel.vue`；悬浮形态 `FloatingBubble.vue` + `FloatingRoot.vue` + `FloatingSettings.vue`；设置区 `SettingsPanel.vue` + 7 个 tab 组件（`GenerationSettings.vue`/`PromptEditor.vue`/`ApiEditor.vue`/`WorldInfoEditor.vue`/`AppearanceSettings.vue`/`DebugSettings.vue` 等）；条目池管理 `PoolEditor.vue`/`EntryPoolDialog.vue`/`PoolGenDialog.vue`/`SelectEntriesDialog.vue`/`ImportEntriesDialog.vue`；通用 `ConfirmDialog.vue`/`CreateConfigDialog.vue`/`GuidePopover.vue`/`PageGuide.vue`；新增 `shared/`（设计系统基础组件，见上节）。
- `docs/` — 技术方案文档（`async-action-options-spec.md`）与早期MVP原型，作为背景参考，不是当前实现标准；UI 重构方案见另外维护的 `choice-ui-redesign-spec.md`（主体页面）与 `choice-floating-bubble-design.md`（悬浮球专项），本文件是二者的执行摘要，细节推理以那两份为准。

## 三层条目池 & 抽取算法要点

- 条目字段：`text`、`pinned`、`weight`、`category`、`condition`（表达式格式如`变量名 运算符 值`，例：`地点 == 医院`）。
- 抽取顺序：确定生效池（覆盖式）→ 条件过滤（含固定条目，默认遵守过滤，可配开关）→ 拆分固定/非固定，处理溢出（默认固定条目不砍，全发）→ 按category分组，处理下溢（默认有多少抽多少，不跨层兜底）→ 分组轮询+组内加权无放回抽取（Efraimidis-Spirakis算法：`key = random()^(1/weight)`，降序取）→ 送入prompt前整体shuffle一次（默认开启，避免固定条目位置固定造成AI顺序偏好）。
- 详细算法与各开关的默认值见 `docs/async-action-options-spec.md` 第3节。

## 构建与验证

```bash
pnpm install
pnpm build          # 一次性打包，验证TS类型和构建是否通过
npx vue-tsc --noEmit # 单独跑类型检查
```

**`pnpm watch` 由我在独立终端里全程跑着**，不需要agent自己调用——`watch`是常驻进程不会退出，agent的工具调用是"跑命令等结束"模式，扔给它一个不结束的命令会卡住。agent只需要用一次性的`pnpm build`（或`vue-tsc --noEmit`）自查有没有类型/编译错误。

因为`watch`已经在跑，代码改完会自动重新打包，**但浏览器仍然需要手动刷新**才能看到效果（无热更新）。

### 用 Chrome DevTools MCP 自行验证，不要只做静态代码审查

配了 Google 官方的 `chrome-devtools-mcp`（Puppeteer + Chrome DevTools Protocol，仓库 `ChromeDevTools/chrome-devtools-mcp`），改完 UI 相关代码，agent 应该自己打开本地酒馆实例点一遍，而不是"看代码觉得应该没问题"就算完成，也不要指望我去手动刷新确认。

**接入方式**：推荐用 `--autoConnect` 挂到我本地已经开着、已登录的 Chrome 上（而不是每次启动一个全新的无痕实例），这样能保留 SillyTavern 的登录态和已打开的对话，不用每次重新走一遍进入酒馆的流程：

```bash
# 我这边先手动执行一次，启动带远程调试端口的 Chrome（只需启动一次，长期挂着）
open -a "Google Chrome" --args --remote-debugging-port=9222
```

Agent 侧 MCP 配置指向这个已运行的实例（具体注册命令按 Kilo 实际支持的 MCP 配置方式来，核心参数是 `chrome-devtools-mcp@latest --autoConnect`，不要凭记忆假设 Kilo 的注册语法，先查 Kilo 自己的 MCP 接入文档）。

**每次 UI 改动后的自检流程**：
1. 确认 `pnpm build` 无报错（类型检查+打包）。
2. 用 chrome-devtools-mcp 刷新已连接的酒馆页面（不要新开标签页/新实例，避免脱离已登录状态）。
3. 针对改动到的部分，实际执行交互而不是只截图看静态状态：
   - 改了 `ActionOptionsPanel.vue`：触发一次生成，点开选项，确认 behavior（发送/覆盖/尾附）三种模式都能正确写入`#send_textarea`。
   - 改了悬浮球状态机：分别制造 idle/generating/有未读结果/disabled（拔掉API配置或清空条目池）四种场景，截图确认视觉状态和文档第5节描述的一致，且互斥展示没有叠加。
   - 改了弹窗类组件（`ChoiceDialog`迁移后的）：确认打开/关闭动画、点击遮罩关闭、esc关闭这些通用行为没有在迁移中丢失。
   - 涉及响应式布局（`ChoiceField`的`useCompactLayout`）：用 chrome-devtools-mcp 的设备模拟功能把视口收窄到 ~380px，确认 row→stack 切换生效，且没有横向溢出滚动条。
4. 用 chrome-devtools-mcp 读一遍浏览器 console，确认没有新增的报错或警告（尤其是 Vue 的 prop 校验警告、Pinia store 未初始化访问这类改 UI 时容易踩的坑）。
5. 自检发现的问题直接在当前改动里修，不要留到下一轮——"构建通过"不等于"验证通过"，两步都做完才算这项改动完成。

## 已知需要在实现时核实、不要凭记忆假设的点

- 生成函数（`TavernHelper`封装接口 / 酒馆源码里的`generateQuietPrompt`、`generateRaw`）的确切参数签名，是否支持`AbortSignal`。
- `#send_textarea` / `#send_but` 等发送框DOM id 是否与实际安装的酒馆版本一致。
- `character.data.extensions` 命名空间的读写API在目标版本的确切调用方式。
- `TavernHelper`当前版本实际暴露了哪些变量/消息/生成相关接口，以其类型定义（`@types`）为准，不要以文档描述的能力范围直接猜函数名。
- `@vueuse/core` 当前锁定版本（`^13.9.0`）里 `useElementSize`/`onLongPress` 的确切签名和边界行为（比如 `useElementSize` 初次挂载时机、`onLongPress` 是否需要额外处理触摸滚动冲突），改悬浮球交互前先查一遍而不是直接照抄本文档的示例代码。
