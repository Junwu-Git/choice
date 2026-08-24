# 聊天记录过滤规则分组

**目标**: 将 `chat_filter_rules` 从平铺列表改为分组结构，支持按用途（不同卡/预设的正则）组织过滤规则组，每组可独立启用/禁用。

**范围**: 全局 `PromptRules` 中，所有配置共用。

## 数据模型

### 新增 `ChatFilterGroup` 类型

```ts
export const ChatFilterGroup = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  rules: z.array(ChatFilterRule).default([]),
});
```

### `PromptRules` 字段变更

```ts
// 保留旧字段用于迁移，新增字段用于新逻辑
chat_filter_rules: z.array(ChatFilterRule).default([]),  // deprecated
chat_filter_groups: z.array(ChatFilterGroup).default([]),
```

### 迁移 (v6)

旧 `chat_filter_rules` 非空时 → 创建默认分组 `"默认分组"`，将所有规则移入该分组，清空旧字段。

## 改动文件

### 1. `src/type/settings.ts`

- 新增 `ChatFilterGroup` schema + type
- `PromptRules` 新增 `chat_filter_groups` 字段
- 保留 `chat_filter_rules` 用于向后兼容

### 2. `src/store/global-settings.ts`

- `migratePromptModules`: 新增 v6 迁移（旧 `chat_filter_rules` → 默认分组）
- 新增 `sortedEnabledFilterRules` computed: 合并所有启用分组的规则（供 generator 使用）
- 可选：新增 `addFilterGroup` / `removeFilterGroup` 等 store 方法（或留在组件内）

### 3. `src/core/generator.ts`

- `buildChatHistory`: 改用 `chat_filter_groups` 合并启用分组的规则，替代直接读 `chat_filter_rules`

### 4. `src/components/PromptEditor.vue`

UI 重构为分组结构：

```
[折叠头] 聊天记录过滤
  [展开内容]
    描述文本
    [分组1]
      [分组头] ☰ 名称 | 启用开关 | 双击改名 | 🗑 删除
      [分组体] (可折叠)
        [规则行] 类型 | 输入 | ✕
        [新增规则] 按钮
    [分组2]
      ...
    [新增分组] 按钮
```

组件逻辑：
- `addFilterGroup()`: 新建分组 `{ id: uuid, name: '新分组', enabled: true, rules: [] }`
- `removeFilterGroup(id)`: 删除分组 + ConfirmDialog 确认
- `addFilterRule(groupId)`: 向指定分组添加规则
- `removeFilterRule(groupId, idx)`: 从指定分组删除规则
- 分组名双击可重命名（复用模块重命名逻辑）
- 分组启用/禁用开关（`v-model="group.enabled"`）

## 生成器影响

`buildChatHistory` 中：
```ts
// 旧: const rules = gs.settings.prompt_rules.chat_filter_rules ?? [];
// 新:
const groups = gs.settings.prompt_rules.chat_filter_groups ?? [];
const rules = groups.filter(g => g.enabled).flatMap(g => g.rules);
```

## 验证步骤

1. `pnpm build` 确认编译通过
2. 浏览器刷新，打开提示词编辑界面
3. 旧数据：确认 `chat_filter_rules` 被迁移到"默认分组"中
4. 新增分组 → 输入名称 → 添加规则
5. 禁用某分组 → 生成选项 → 确认该分组规则不生效
6. 删除分组 → 确认弹窗 → 分组消失
7. 多分组同时启用 → 确认所有规则合并生效