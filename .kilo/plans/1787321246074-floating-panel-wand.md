# 浮动面板 + 魔法棒入口 + 悬浮球 重构计划

## 目标

- 将设置面板从 `#extensions_settings2`（扩展程序区）移除
- 魔法棒菜单（`#extensionsMenu`）保留一个入口按钮，点击弹出独立可拖动设置弹窗
- 手机尺寸界面显示可拖动悬浮球，点击打开同一设置弹窗
- 悬浮球和弹窗均可拖动
- 聊天区下方的 `ActionOptionsPanel` 保留不变
- 选项显示格式优化：用 `|` 分隔标题与内容，去除双引号

## 架构决策

| 决策 | 方案 |
|------|------|
| 共享状态 | 模块级 `src/core/floating-state.ts` 导出 `isSettingsOpen: Ref<boolean>` |
| 拖动实现 | `useDraggable`（已 auto-import，`@vueuse/core`），弹窗 header 为 drag handle，悬浮球整体可拖 |
| 移动端断点 | `useMediaQuery('(max-width: 768px)')` |
| 位置持久化 | `useStorage`（localStorage）保存弹窗/悬浮球坐标 |
| 魔法棒容器 | 动态检测 `#extensionsMenu`，若 `#choice_wand_container` 不存在则创建后追加 |
| Vue App 架构 | 新建一个独立 Vue app 挂载 `FloatingRoot.vue`（Teleport 到 body），共享 Pinia 实例 |
| 旧 SettingsPanel | 保留文件不动（后续可删），仅移除 `initPanel()` 调用 |

## 文件变更清单

### 新建

| 文件 | 说明 |
|------|------|
| `src/core/floating-state.ts` | 导出 `isSettingsOpen` ref，toggle 函数 |
| `src/components/FloatingRoot.vue` | 根组件，同时渲染 FloatingSettings + FloatingBubble |
| `src/components/FloatingSettings.vue` | 可拖动设置弹窗（含 5 个 tab：条目池/提示词/API/行为/世界书） |
| `src/components/FloatingBubble.vue` | 可拖动移动端悬浮球 |
| `src/core/wand-menu.ts` | 魔法棒菜单集成：创建容器 + 按钮 + 点击打开弹窗 |

### 修改

| 文件 | 变更 |
|------|------|
| `src/index.ts` | 移除 `initPanel()` 调用及 import；添加 `initFloatingApp()` + `initWandMenu()` 调用 |
| `src/components/ActionOptionsPanel.vue` | 添加 `formatOptionDisplay` 函数：去除双引号，` | ` 替换首个 `: ` |

### 删除

| 文件 | 说明 |
|------|------|
| `src/panel.ts` | 不再需要（SettingsPanel 挂载到 `#extensions_settings2` 的逻辑已废弃） |

## 实现步骤

### 1. 创建共享状态模块 `src/core/floating-state.ts`

```ts
export const isSettingsOpen = ref(false);
export function toggleSettings() { isSettingsOpen.value = !isSettingsOpen.value; }
export function openSettings() { isSettingsOpen.value = true; }
export function closeSettings() { isSettingsOpen.value = false; }
```

### 2. 创建 `FloatingSettings.vue`（可拖动设置弹窗）

- 使用 `<Teleport to="body">` 渲染遮罩 + 弹窗
- 弹窗 header 作为 `useDraggable` 的 handle
- `position: fixed`，初始位置居中（基于 window.innerWidth/Height 计算）
- 使用 `useStorage` 持久化坐标到 localStorage
- 点击遮罩（`@click.self`）关闭；Esc 键关闭（`useEventListener`）
- body 内复用 SettingsPanel 的 tab 结构（5 个 tab 按钮 + 条件渲染子组件）
- 关闭按钮（×）在 header 右侧
- 最小宽度 500px，最大宽度 90vw，最大高度 85vh，overflow-y: auto
- 层级 `z-index: 10000`（高于 ST 的 modal/sheet）

### 3. 创建 `FloatingBubble.vue`（可拖动移动端悬浮球）

- 使用 `useMediaQuery('(max-width: 768px)')` 控制显隐
- 固定圆形按钮（50-56px），wand-magic-sparkles 图标
- 整个元素作为 `useDraggable` 目标（无 handle，整体可拖）
- `position: fixed`，初始位置右下角
- 使用 `useStorage` 持久化坐标
- 点击（非拖动）调用 `openSettings()`；拖动时抑制 click（通过比较 mousedown/mouseup 坐标差）
- 层级 `z-index: 9999`
- 半透明背景 + hover 高亮，带轻微阴影

### 4. 创建 `FloatingRoot.vue`（根组件）

```vue
<template>
  <FloatingSettings />
  <FloatingBubble />
</template>
```

### 5. 创建 `src/core/wand-menu.ts`（魔法棒菜单集成）

- 轮询检测 `#extensionsMenu` 是否存在（最多 30 次 × 200ms）
- 创建 `<div id="choice_wand_container" class="extension_container">` 追加到 `#extensionsMenu`
- 创建按钮（`list-group-item flex-container flexGap5` + `extensionsMenuExtensionButton` class）
- 点击调用 `openSettings()`
- 同时隐藏 `#extensionsMenu` 下拉菜单（触发 wand 按钮的 click 收起）

### 6. 修改 `src/index.ts`

- 删除 `import { initPanel } from '@/panel'`
- 删除 `initPanel()` 调用
- 添加 `initFloatingApp()` 函数：创建 `<div id="choice-floating-root">` 追加到 body，挂载 `FloatingRoot.vue`（共享 pinia）
- 添加 `initWandMenu()` 调用
- 确保 `initFloatingApp()` 在 `setActivePinia(pinia)` 之后调用

### 7. 删除 `src/panel.ts`

### 8. 选项显示格式化（`ActionOptionsPanel.vue`）

- 添加 `formatOptionDisplay` 函数：
```ts
const formatOptionDisplay = (text: string): string => {
  return text
    .replace(/"/g, '')
    .replace(/: /, ' | ');
};
```
- 模板中 `{{ option.text }}` 改为 `{{ formatOptionDisplay(option.text) }}`
- `onSelect` 仍使用原始 `option.text` 做内容提取，不依赖显示格式化

## 验证步骤

1. `pnpm build` 通过，无类型/编译错误
2. 浏览器刷新酒馆页面：
   - 扩展程序区（`#extensions_settings2`）不再显示 Choice 设置面板
   - 魔法棒菜单中出现 Choice 入口按钮
   - 点击魔法棒入口 → 弹出可拖动设置面板 → 5 个 tab 可切换
   - 拖动弹窗 header → 弹窗跟随移动，松手位置保持
   - 点击遮罩或 × 按钮 → 弹窗关闭
   - 缩小浏览器到 ≤768px → 右下角出现悬浮球
   - 拖动悬浮球 → 位置跟随，松手不触发 click
   - 点击悬浮球 → 弹出设置面板
   - 聊天区下方 ActionOptionsPanel 仍然正常显示和工作

## 风险与注意事项

- **魔法棒容器注入时机**：`addExtensionsButtonAndMenu()` 是异步 HTML 模板渲染，需轮询等待 `#extensionsMenu` 出现。若轮询超时，静默失败（不影响主体功能）。
- **`useDraggable` 与 touch 事件**：`@vueuse/core` 的 `useDraggable` 支持 pointer 事件，兼容桌面和移动端触摸。
- **弹窗内部滚动**：拖动手柄不应触发内部滚动；弹窗 body 可独立滚动（`overflow-y: auto`）。
- **z-index 层级**：ST 的 modal 使用 z-index 3000-9000，弹窗需设为 10000，悬浮球 9999。
- **SettingsPanel.vue 保留不删**：以防后续需要回退或参考，仅移除挂载调用。
- **BehaviorSettings 中 behavior 下拉框与 ActionOptionsPanel 分段按钮保持双向同步**（已有逻辑通过 Pinia store 同步，无需改动）。