# BehaviorSettings 清理与重命名

## 目标

清理 BehaviorSettings.vue 中的冗余 UI 和死代码，重命名含义不清的标签。

## 改动清单

### 1. 删除第一排"选中后"下拉框

**文件**: `src/components/BehaviorSettings.vue` 第14-21行

删除整个 `<label class="choice-field">` 块，包含 `<select v-model="chatStore.settings.behavior">` 及其三个 `<option>`。

**原因**: ActionOptionsPanel.vue 第41-51行已有 pill 分段按钮提供相同功能，双向同步同一个 `chatStore.settings.behavior`，BehaviorSettings 里的下拉框是重复入口。

**影响**: 第一排从 3 个 field 变为 2 个（选项数量 + 固定条目溢出），flex 布局自适应。`chatStore` 仍被"自动生成"复选框使用，无需删除引用。

### 2. 删除第二排"固定也过滤"复选框

**文件**: `src/components/BehaviorSettings.vue` 第47-51行

删除整个 `<label class="choice-check">` 块，包含 `v-model="generation.pinned_follows_condition"`。

**原因**: `pinned_follows_condition` 字段已在 `GenerationSettings` schema 中移除（`src/type/settings.ts:15-24`），迁移代码也做了清理（`src/store/global-settings.ts:236-238`）。该 v-model 绑定到不存在的字段，是死代码，不会生效。

**影响**: 第二排网格从 4 个变 3 个（自动生成、分类多样性、打乱选项顺序），`grid-template-columns: 1fr 1fr` 保持不变，3 个元素会自动填充 2 列 + 1 个单独成行。

### 3. "最终洗牌"重命名为"打乱选项顺序"

**文件**: `src/components/BehaviorSettings.vue` 第45行

将 `{{ t\`最终洗牌\` }}` 改为 `{{ t\`打乱选项顺序\` }}`。

**原因**: "最终洗牌"含义不清，用户看名字不知道有什么用。实际功能是：固定条目 + 随机抽取条目合并后，整体 Fisher-Yates 打乱顺序，避免固定条目总排在最前面导致 AI 位置偏好。

### 4. "分类多样性"保留不变

不做改动。该开关控制抽取算法：开启时按 category 分组轮询抽取（`drawByCategories`），关闭时全局加权抽取（`weightedPick`），与条目池 UI 层面的分组织是两个不同维度，不冗余。

## 验证

```bash
pnpm build
```

浏览器中打开行为设置面板（悬浮窗 → 行为标签），确认：
- 第一排只有"选项数量"和"固定条目溢出"两个字段
- 第二排只有"自动生成"、"分类多样性"、"打乱选项顺序"三个复选框
- 无控制台报错
- ActionOptionsPanel 中的发送/覆盖/尾附按钮仍正常工作