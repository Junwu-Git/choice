# 配置编辑内联化 & 抽取参数置顶

## 背景

当前 `PoolEditor` 的配置编辑通过 `ConfigDialog` 弹窗实现，用户需点击"编辑"按钮→弹出弹窗→编辑→保存→关闭。抽取参数位于弹窗底部（条目列表之后）。

## 需求

1. 配置编辑**不弹窗**，直接在 `PoolEditor` 主区域始终可编辑（无需切换编辑/只读模式）
2. 抽取参数（generation settings）放在**所有条目列表的最顶端**
3. 条目库按钮保留为独立按钮（不改为内联）

## 目标布局

```
PoolEditor
├── 配置工具栏 (保留：下拉选择器 + 操作按钮组，移除"编辑"按钮)
│   ├── [配置下拉] [设为默认][绑定聊天][绑定角色][删除][新建]
│   └── 当前生效: xxx [聊天] [角色] [全部]
├── HR 分隔线
├── 配置名称 (inline text input)
├── 抽取参数 (generation settings) ← 置顶
│   ├── 数量 (count_mode)
│   ├── 分组抽取 (categories_enabled)
│   ├── 打乱结果 (shuffle_final)
│   ├── 固定条目参与条件过滤 (pinned_follows_condition)
│   └── 固定溢出 (pinned_overflow)
├── 条目列表 (scrollable)
│   ├── 条目1 [✓] 固定[ ] 权重[1] 条件[...]
│   ├── 条目2 [✓] 固定[✓] 权重[2] 条件[地点 == 医院]
│   └── ...
├── HR 分隔线
└── 条目库 (N) 按钮
```

## 文件变更

### 1. `src/components/PoolEditor.vue` — 主要改动

**模板部分**：
- 移除工具栏中的"编辑"按钮（`openEditDialog`）
- 移除 `<ConfigDialog>` 组件引用
- 在 `<hr>` 之后、条目库按钮之前，新增内联编辑区域：
  - 配置名称输入框 (`v-model="selectedConfig.name"`)
  - 抽取参数区域（5 个字段，绑定 `selectedConfig.generation`）
  - 条目列表（遍历 `masterPool`，每个条目显示 checkbox + 覆盖属性）
  - 条目列表用 `max-height` + `overflow-y: auto` 限制高度
- 空状态处理：当 `configs` 为空时隐藏编辑区域，显示提示文字

**脚本部分**：
- 移除 `ConfigDialog` 导入
- 移除 `klona` 导入（仅用于弹窗克隆，不再需要）
- 移除 `showConfigDialog`、`editingConfig` ref
- 移除 `openEditDialog`、`onConfigSave` 函数
- 新增导入：`uuidv4`（来自 `@sillytavern/scripts/utils`）、`GenerationSettings`（来自 `@/type/settings`）
- 重写 `openNewDialog` → `createNewConfig`：直接构造 `PoolConfig` 对象，默认选中全部 master_pool 条目，`configs.value.push()` 后自动选中
- 新增辅助函数：
  - `getConfigEntry(id)` — 从 `selectedConfig.entries` 中找到对应 `PoolConfigEntry`，找不到则基于 master_pool 创建并 push 到数组，返回该对象
  - `toggleConfigEntry(id)` — 调用 `getConfigEntry` 或 splice 删除，切换选中状态
  - `entrySummary(entry)` — 条目文本摘要（从 ConfigDialog 搬过来，`text.trim().replace(/"/g, '').slice(0, 50)`）

**关键数据绑定**：
- `selectedConfig` 是 computed，直接引用 store 响应式对象，`v-model` 直接绑定
- 条目列表遍历 `masterPool`，checkbox 绑定 `isEntrySelected(id)` 判断，覆盖属性绑定 `getConfigEntry(id).pinned/weight/condition`
- 内联编辑区域外层用 `v-if="selectedConfig && configs.length > 0"` 守卫

**样式部分**：
- 新增内联编辑区域的样式（从 ConfigDialog 搬入并调整为非弹窗风格）
- 条目列表容器样式（边框、滚动、最大高度）

### 2. `src/components/ConfigDialog.vue` — 删除或保留

不再被 `PoolEditor` 引用。可以删除文件，或保留但不再使用。建议删除以减少维护负担。

### 3. 不涉及的文件

- `EntryPoolDialog.vue` — 保持不变
- `src/store/global-settings.ts` — 保持不变（store 已有 `deep: true` watch 自动保存）
- `src/type/settings.ts` — 保持不变

## 数据流

- `selectedConfig` 是 computed，直接引用 store 中响应式对象
- 用户编辑 `selectedConfig.name` / `selectedConfig.generation.xxx` → 直接修改 store → `deep: true` watch 触发 → `saveSettingsDebounced()` 自动保存
- 条目选中/取消：`config.entries` 数组的 push/splice → 同样触发自动保存
- 新建配置：`configs.value.push(newConfig)` → 自动保存

## 边界情况

1. **无配置时**：工具栏显示"暂无配置"，编辑区域隐藏，只显示"条目库"按钮
2. **条目库为空时**：条目列表区域显示"条目库为空，请先在条目库中添加条目"提示
3. **切换配置时**：`selectedConfig` 自动变更，编辑区域自动刷新（Vue 响应式）
4. **删除当前配置时**：`selectedConfigId` 自动切换到有效配置，编辑区域跟随更新
5. **新建配置**：默认选中全部 master_pool 条目，默认 generation settings

## 验证步骤

1. `pnpm build` 确认无类型/编译错误
2. 浏览器刷新酒馆页面
3. 打开 FloatingSettings → 条目池标签
4. 验证：工具栏无"编辑"按钮，下方直接显示名称/抽取参数/条目列表
5. 修改配置名称，切换配置再切回，确认名称已持久化
6. 修改抽取参数，确认保存
7. 勾选/取消条目，确认条目列表更新
8. 修改条目覆盖属性（固定/权重/条件），确认保存
9. 新建配置，确认自动选中全部条目
10. 删除配置，确认 UI 切换到下一个配置