# 行动选项（choice）插件 UI 重构技术方案

> 面向对象：负责实施的编码 Agent（如 Kilo）
> 目标：在**不改动业务逻辑 / store / core 层**的前提下，系统性地重做视觉与交互，解决"简单单调、不美观、混乱"的问题
> 基线：已 clone 并审阅 `Junwu-Git/choice` 仓库源码（Vue3 + Pinia + Zod + Vite，单文件打包为 `dist/index.js`，无 Tailwind）

---

## 0. 现状诊断（基于源码，不是猜测）

逐一看过 `src/components/*.vue` 和 `src/theme.css` 后，问题集中在三层：

### 0.1 设计令牌层不完整
`src/theme.css` 目前只定义了颜色（primary/bg/text/border）、4 档圆角、3 档阴影、2 档过渡时长。**完全没有间距（spacing）体系和字号（typography）体系**。结果是每个组件各写各的 `padding`、`gap`、`font-size`（甚至直接内联 `style="width: 60px"`，见 `AppearanceSettings.vue`），20 个组件、7000+ 行代码里 `padding: 6px 10px` `padding: 8px 12px` `padding: 4px 0` 这类数值随手写，没有统一节奏，视觉上就是"乱"的直接原因。

### 0.2 组件层严重不一致
- **`ActionOptionsPanel.vue`（挂在聊天楼层下的主面板）** 是全仓库做得最好的部分：卡片化选项按钮、分段清晰、有 hover/active 反馈。**这部分只需微调，不需要重做**。
- **设置区（`SettingsPanel.vue` + 7 个 tab 组件）** 混用了 SillyTavern 原生类（`.text_pole` `.sysHR` `.inline-drawer`）和自定义 `.choice-*` 类，两套视觉语言拼在一起。
- **`EntryPoolDialog.vue`（1024 行）、`PoolEditor.vue`（708 行）、`PromptEditor.vue`（1107 行）** 是"混乱"感的主要来源：一行里塞了 checkbox + chevron + 摘要文本 + pin 徽章 + 下拉框 + 删除按钮（见 `EntryPoolDialog.vue` 条目行），信息密度过高且没有分组留白，头部工具栏一排 5-6 个纯图标按钮堆在一起，靠 `title` 属性做说明，用户第一眼看不出各按钮的重要性差异。
- 各种 Dialog（`ConfirmDialog` `CreateConfigDialog` `SelectEntriesDialog` `ImportEntriesDialog` `PoolGenDialog`）**没有共享的弹窗外壳组件**，每个都各自实现 overlay/header/footer，样式和留白都有细微差异。

### 0.3 缺少组件化的"设计系统基础件"
所有卡片、字段行、分段标题、徽章都是在各个 `.vue` 文件里用裸 `div` + scoped class 手写的，没有 `ChoiceCard` / `ChoiceField` / `ChoiceSection` 这类可复用基础组件。这是导致"改一处不一致、维护越改越乱"的根因，也是本次重构要优先解决的架构问题，而不只是调颜色。

**结论：这不是一次配色问题，是缺一层设计系统。方案分两部分：先补基础设施（token + 基础组件），再用基础设施翻新高优先级页面。**

---

## 1. 设计方向（先定风格，避免 Agent 自由发挥跑偏）

沿用现有暗色/亮色双主题、蓝色主色（`#4a90d9`）体系，不换色，因为 `ActionOptionsPanel.vue` 已经证明这套配色是可行的，问题不在配色。方向定为：

- **克制的卡片化 + 明确的信息层级**，不是花哨的玻璃拟态或强动效。原型参考仍是用户提过的"游戏选择分支"按钮式——大按钮、清晰分组、留白充足。
- **移动端优先**：SillyTavern 大量用户在手机上用，所有新组件断点、点击热区（≥40px）、字号必须先在窄屏（~380px）验证再扩展到桌面。
- **不引入 Tailwind**（README 已明确说明会和酒馆页面样式冲突），继续用 scoped CSS + CSS 自定义属性（token）。

---

## 2. 第一阶段：补齐设计令牌（扩展 `theme.css`）

在现有 `:root` 基础上新增两组变量，两套主题（dark/light）都要覆盖：

```css
/* 间距体系：4px 基准网格，替代所有随手写的 padding/gap 数值 */
--choice-space-1: 4px;
--choice-space-2: 8px;
--choice-space-3: 12px;
--choice-space-4: 16px;
--choice-space-5: 24px;
--choice-space-6: 32px;

/* 字号体系：在现有 --choice-font-scale 缩放基础上定义语义化档位 */
--choice-text-xs: calc(11px * var(--choice-font-scale));
--choice-text-sm: calc(13px * var(--choice-font-scale));
--choice-text-base: calc(15px * var(--choice-font-scale));
--choice-text-lg: calc(17px * var(--choice-font-scale));
--choice-text-xl: calc(20px * var(--choice-font-scale));

/* z-index 分层：目前 floating bubble 硬编码 9999，弹窗/浮层各写各的，需要统一 */
--choice-z-panel: 10;
--choice-z-dropdown: 100;
--choice-z-dialog: 1000;
--choice-z-floating: 9000;
--choice-z-popover: 9500;
```

**验收标准**：全仓库搜索 `padding: \d+px`、`gap: \d+px`、`font-size: \d+px`（不经过 `--choice-` 变量的），全部替换为上面的 token。这一步是机械替换，可以让 Agent 先跑一遍全局替换再逐个 review。

---

## 3. 第二阶段：新增共享基础组件（`src/components/shared/`）

目前 `src/components/shared/` 只有 `tab-definitions.ts`。新增以下 4 个纯展示型组件，供后续所有页面复用，**禁止新组件再手写 div 拼卡片**：

### 3.1 `ChoiceSection.vue` —— 分段容器
带标题（可选图标）+ 可选的折叠功能，替代目前 `PoolEditor.vue`/`AppearanceSettings.vue` 里裸写的 `.choice-appearance-section` / `.choice-inline-field`。

Props: `title`, `icon?`, `collapsible?: boolean`, `defaultOpen?: boolean`

### 3.2 `ChoiceCard.vue` —— 列表行卡片
替代 `EntryPoolDialog.vue` 里那种"一行塞 6 个控件"的写法。核心改动：**把"摘要信息"和"操作按钮"拆成两行**，而不是挤在一行：
- 第一行：勾选框 + 展开箭头 + 内容摘要 + 状态徽章（pinned/分类），右对齐留一个"更多操作"入口（而不是把删除、复制等全部铺开）
- 第二行（展开时）：详细字段，用 `ChoiceField` 网格排列

Props: `expanded`, `selected`, slots: `#summary` `#badges` `#actions` `#details`

### 3.3 `ChoiceField.vue` —— 表单字段行
统一 label + input 的间距和对齐，替代目前每个 tab 组件里格式不一的 `<label class="choice-inline-gen-item">`。支持 `layout: 'row' | 'stack'`（横排用于紧凑设置，竖排用于移动端窄屏，通过容器查询或 `--choice-field-layout` 变量自动切换，不要写死）。

### 3.4 `ChoiceDialog.vue` —— 弹窗外壳
统一 `EntryPoolDialog` / `ConfirmDialog` / `CreateConfigDialog` / `SelectEntriesDialog` / `ImportEntriesDialog` / `PoolGenDialog` 六个弹窗的 overlay、header（标题+关闭按钮）、footer（操作按钮区）、最大高度和滚动行为。这六个文件现在各自实现一遍 `.choice-epool-overlay` 之类的样式，统一后能同时解决"不一致"和"代码重复"两个问题。

Props: `open`, `title`, `icon?`, slots: `#header-actions` `#default` `#footer`

**验收标准**：六个 Dialog 组件迁移完成后，各自文件里不应再出现独立的 `overlay`/`header` scoped CSS——全部来自 `ChoiceDialog`。

---

## 4. 第三阶段：分优先级翻新页面

### 优先级 P0（高可见度、低风险，先做出效果）
1. **`ActionOptionsPanel.vue`**：保留现有结构，仅做细节打磨——`choice-option-btn` 的 padding 换成 token、增加选项序号（1/2/3…）提升"游戏分支选择"的即视感、loading 态的骨架屏样式（现有 shimmer bar 太单薄，改成 2-3 行的骨架卡片占位，让"生成中"看起来像选项即将出现，而不是一条进度条）。
2. **`FloatingBubble.vue` / `FloatingSettings.vue`**：气泡本身已经不错，`FloatingSettings.vue`（314 行的浮窗设置面板）要复用 `ChoiceDialog`，目前它和 `SettingsPanel.vue` 是两套独立实现，同一个设置在两个入口下观感不同。

### 优先级 P1（用户最常抱怨"混乱"的区域）
3. **`EntryPoolDialog.vue`**：改用 `ChoiceCard`，条目行拆成"摘要行 + 展开详情"两层，头部 5 个图标按钮按使用频率分组——"新建分组""AI 生成"这类主操作保留可见按钮，"全部展开/收起""粘贴导入"这类次要操作收进一个 `···` 更多菜单。分组（`choice-epool-group`）的展开/收起动画要加（目前直接用 `is-collapsed` class 硬切换，没有 transition）。
4. **`PoolEditor.vue`**：用 `ChoiceSection` 重新组织"配置工具栏 / 抽取参数 / 已选条目"三块，"抽取参数"里 4 个控件横排挤在一起（count_mode 输入框 + 2 个 checkbox + 下拉），改成 `ChoiceField` 网格，窄屏自动折成两列。
5. **`PromptEditor.vue`**（最大的文件，1107 行）：需要单独看一遍其模板结构再定具体方案，但原则一致——用 `ChoiceSection` 分组、长文本编辑区域给够高度和可调整大小的把手（`SettingsPanel.vue` 已有面板整体拖拽调高逻辑，`onResizeStart` 可以抽成 composable 复用到 textarea 上）。

### 优先级 P2（收尾一致性）
6. `SettingsPanel.vue` 的 tab 栏：当前 7 个 tab + 1 个帮助按钮平铺一行，窄屏会挤压换行，建议移动端下改为可横向滚动的 tab 栏（`overflow-x: auto` + 隐藏滚动条），而不是让文字挤压变形。
7. 其余小型 Dialog 统一迁移到 `ChoiceDialog`。

---

## 5. 移动端断点与验证

**技术选型已确认：不用 CSS `@container`，改用 `@vueuse/core` 的 `useElementSize` + `ResizeObserver` 做窄屏判断。**

原因：SillyTavern 是自建服务，插件方无法控制用户用什么内核打开（可能是标准浏览器，也可能是套壳 webview，国内常见的微信内置浏览器/UC/QQ浏览器/部分安卓 ROM 系统 WebView 内核版本经常滞后），`@container` 一旦不被支持是**静默失效**（规则整条被忽略，不报错），窄屏和宽屏会用同一套布局，反而制造新的"某些用户觉得插件显示乱"的投诉。而 `@vueuse/core` 已是仓库现有依赖（`FloatingBubble.vue` 已在用它的 `useDraggable`/`useStorage`），用 JS 判断宽度、切 class，行为在任何环境下都一致，不存在能力检测问题，也不需要额外维护一套 fallback。

统一断点仍是 420px（对应 SillyTavern 聊天区容器常见宽度 ~360-420px 手机 / ~500-700px 平板侧栏）。具体实现：

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

`ChoiceField.vue` 内部用这个 composable 给根节点绑 `:class="{ 'is-compact': isCompact }"`，CSS 侧对应写：

```css
.choice-field { /* row 布局，默认 */ }
.choice-field.is-compact { /* stack 布局 */ }
```

**验收标准**：凡是新写的横排字段（`ChoiceField` 及后续基于它的组件），必须在 420px 容器宽度下手动验证不换行错位；不再需要额外验证 container query 的浏览器/内核兼容性，因为方案里已经不依赖它。

---

## 6. 交给 Agent 的执行顺序（建议按此拆 PR / commit）

1. `theme.css`：新增 spacing / typography / z-index token（第 2 节）—— 纯增量，无风险，独立提交
2. 新建 `src/components/shared/Choice{Section,Card,Field,Dialog}.vue` 四个基础组件 —— 先写好，先在 Storybook 式的临时页面或直接在 `PoolGenDialog.vue`（相对简单）里试用验证观感
3. P0：`ActionOptionsPanel.vue` 细节打磨 + `FloatingSettings.vue` 迁移到 `ChoiceDialog`
4. P1：`EntryPoolDialog.vue` → `PoolEditor.vue` → `PromptEditor.vue`，逐个替换，每替换完一个跑一次 `pnpm build` + 手动在酒馆里过一遍交互（这几个文件都有拖拽排序、展开状态等交互逻辑，重构 CSS 时容易连带破坏 JS 行为，需要针对性回归）
5. P2：其余 Dialog 统一迁移 + tab 栏移动端滚动

每一步都不改 `src/core/*` 和 `src/store/*`，只动 `src/components/*.vue` 和 `theme.css`，风险可控，出问题也容易定位到具体 commit。

---

## 7. 明确不做的事（防止 Agent 过度设计）

- 不引入 Tailwind / UnoCSS 等原子化 CSS 框架（README 已说明会冲突）
- 不改配色主色调（蓝色系已验证可用），只补充间距/字号 token
- 不给 `ActionOptionsPanel.vue` 做大改，它是现有代码里视觉最完成度高的部分，改动应最小化
- 不引入新的状态管理逻辑，纯展示层重构
