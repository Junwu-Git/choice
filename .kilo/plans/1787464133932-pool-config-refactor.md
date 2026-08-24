# 条目池配置化重构

将三层独立条目池（全局/角色/聊天覆盖式）重构为"总条目库 + 配置绑定"架构。

## 数据模型

### 新增 `PoolConfig` 类型

```typescript
// 配置中的单条条目引用，可独立覆盖 master_pool 中的 pinned/weight/condition
const PoolConfigEntry = z.object({
  entry_id: z.string(),  // 引用 master_pool 条目 id
  pinned: z.boolean().default(false),
  weight: z.number().min(0).default(1),
  condition: z.string().default(''),
});

const PoolConfig = z.object({
  id: z.string(),
  name: z.string(),
  entries: z.array(PoolConfigEntry),  // 替换旧 entry_ids
  is_default: z.boolean().default(false),
  generation: GenerationSettings.prefault({}),
});
```

### `GlobalSettings` 变更

- 新增 `master_pool: PoolEntry[]`（总条目库）
- 新增 `configs: PoolConfig[]`（配置列表）
- 移除 `pool` 字段
- 移除 `generation` 字段（已移至 `PoolConfig.generation`）
- `schema_version` 升至 9

### `CharacterSettings` 变更

- 新增 `config_id: string | null`
- 移除 `pool` 字段

### `ChatSettings` 变更

- 新增 `config_id: string | null`
- 移除 `pool` 字段

## 任务列表

### 1. 更新类型定义 (`src/type/settings.ts`)

- 新增 `PoolConfigEntry` Zod schema 及类型（entry_id/pinned/weight/condition）
- 新增 `PoolConfig` Zod schema 及类型（使用 `entries: PoolConfigEntry[]` 替代旧 `entry_ids`）
- 更新 `GlobalSettings`：移除 `pool`/`generation`，新增 `master_pool`/`configs`，`schema_version` 默认值不变（迁移逻辑处理升级）
- 更新 `CharacterSettings`：移除 `pool`，新增 `config_id`
- 更新 `ChatSettings`：移除 `pool`，新增 `config_id`
- `SCHEMA_VERSION` 从 8 → 9

### 2. 迁移逻辑 (`src/store/global-settings.ts`)

在 `applyDefaults` 中新增 schema_version 8→9 迁移：

- 收集三层旧池数据：`extension_settings.choice.pool` / `character.data.extensions.choice.pool` / `chat_metadata.choice.pool`
- 按 text 去重（相同 text 只保留一条，id 用最先出现的），合并为 `master_pool`
- 创建自动配置（使用新 `entries` 格式，pinned/weight/condition 从原始 PoolEntry 复制）：
  - `"全局默认"`：包含原全局层条目，`is_default: true`
  - `"角色 [角色名]"`：包含原角色层条目
  - `"聊天 [聊天名]"`：包含原聊天层条目
- 设置绑定：聊天配置 id → `chat_metadata.choice.config_id`，角色配置 id → `character.data.extensions.choice.config_id`
- 删除旧字段：`extension_settings.choice.pool`、`extension_settings.choice.generation`、角色/聊天中的 `pool`
- 额外处理：如果 configs 中存在旧格式 `entry_ids`（开发构建残留），自动转换为 `entries` 格式

### 3. 重写 `pool-selector` store (`src/store/pool-selector.ts`)

```typescript
effectiveConfig: computed(() => {
  // 聊天绑定 → 角色绑定 → 默认配置 → null
  const chatConfigId = chatStore.settings.config_id;
  if (chatConfigId) return configs.find(c => c.id === chatConfigId);
  const charConfigId = characterStore.settings.config_id;
  if (charConfigId) return configs.find(c => c.id === charConfigId);
  return configs.find(c => c.is_default) ?? null;
})

effectivePool: computed(() => {
  const config = effectiveConfig.value;
  // 没有任何配置（包括无默认配置）时，兜底返回总条目库全部条目
  if (!config) return [...master_pool];
  // 配置中的 entries 覆盖 master_pool 的 pinned/weight/condition
  const entryMap = new Map(config.entries.map(e => [e.entry_id, e]));
  return master_pool
    .filter(e => entryMap.has(e.id))
    .map(e => {
      const cfg = entryMap.get(e.id)!;
      return { ...e, pinned: cfg.pinned, weight: cfg.weight, condition: cfg.condition };
    });
})
```

- 移除 `effectiveLayer`、`layerActive`、`PoolLayer` 类型及导出
- 新增 `effectiveConfig` 导出

### 4. 更新 `generator.ts` (`src/core/generator.ts`)

**`generateOptions`（行动选项生成）**：

- 从 `ps.effectiveConfig?.generation` 读取抽取参数，替代 `gs.settings.generation`
- 当 `effectiveConfig` 为 null 时，用 `GenerationSettings` 默认值兜底

**`generatePoolEntries`（条目池 AI 生成）**：

- 移除 `layer` 参数，改为读取 `master_pool` 作为已有条目上下文
- 删除 `poolOfLayer` 函数
- 更新 `import PoolLayer` → 不再需要

**`PoolGenItem` 类型**：无变化

### 5. 重写 `PoolEditor.vue`

改为配置主导的简洁布局：

**配置工具栏（顶部）**：
- 下拉框 `<select>` 列出所有配置，默认选中当前生效的配置（按优先级：聊天 > 角色 > 默认）
- 切换下拉时不自动绑定，仅改变当前管理对象
- 操作按钮（横向排列）：
  - "编辑" → 打开 `ConfigDialog`（编辑模式）
  - "设为默认" → 设置当前选中配置为默认
  - "绑定聊天" → 绑定/解绑当前选中配置到聊天（toggle）
  - "绑定角色" → 绑定/解绑当前选中配置到角色（toggle）
  - "删除" → 删除当前选中配置（默认配置不可删）
  - "+ 新建" → 打开 `ConfigDialog`（新建模式）
- 状态行显示："当前生效: 配置名"（按优先级解析）

**条目库按钮（配置下方）**：
- 一个按钮 `📋 条目库 (N)`，点击打开 `EntryPoolDialog`
- 按钮显示当前总条目数量

### 6. 新增 `ConfigDialog.vue`（配置编辑弹窗）

通过 `<Teleport to="body">` 实现的模态弹窗：

- Props: `open: boolean`, `config: PoolConfig | null`（null = 新建模式）
- 内容：
  - 配置名称输入框
  - 条目列表（从 `master_pool` 遍历，每行显示）：
    - 勾选框（决定是否包含该条目）
    - 条目文本摘要
    - `pinned` 勾选框（默认从 master_pool 取值）
    - `weight` 数字输入（默认从 master_pool 取值）
    - `condition` 文本输入（默认从 master_pool 取值）
  - 抽取参数表单（count_mode / categories_enabled / shuffle_final / pinned_follows_condition / pinned_overflow）
- 按钮：保存 / 取消
- Emits: `close`, `save: (config: PoolConfig)`
- 新建时自动生成 id，如果是第一个配置自动设为默认
- 保存时直接操作 `globalStore.settings.configs`
- 新建时默认选中 master_pool 全部条目，pinned/weight/condition 从 master_pool 复制

### 7. 新增 `EntryPoolDialog.vue`（条目库编辑弹窗）

通过 `<Teleport to="body">` 实现的模态弹窗，专用于编辑总条目库：

- Props: `open: boolean`
- 内容：
  - 条目列表（可折叠展开，编辑 text/pinned/weight/category/condition）
  - "添加条目" 按钮
  - "AI 生成" 按钮 → 打开 `PoolGenDialog`，注入到 `master_pool`
  - 删除条目时同步清理所有配置中对该条目的引用
- 直接操作 `globalStore.settings.master_pool`
- Emits: `close`

### 8. 更新 `PoolGenDialog.vue`（已部分完成）

- 移除"注入到"下拉框和 `layer` 参数 ✅
- 移除 `defaultLayer` prop ✅
- 确认回调：`emit('confirm', { additions, replacements })` ✅
- 打开入口从 `PoolEditor` 改为 `EntryPoolDialog` 内部打开

### 9. 清理引用

- 搜索所有 `PoolLayer` 导入/使用，移除或替换为新的配置模型 ✅
- 搜索所有 `effectiveLayer`/`layerActive` 使用，移除 ✅
- 搜索所有 `poolOf` 类似函数，替换为 `master_pool` ✅

### 10. 边界情况

- **无任何配置（包括无默认配置）**：`effectivePool` 返回总条目库全部条目（使用 master_pool 原始 pinned/weight/condition），抽取参数用 `GenerationSettings` 默认值
- **配置的 entries 引用了已删除的条目**：`effectivePool` 过滤时自动跳过（master_pool 中找不到的 entry_id 被忽略）
- **默认配置被删除**：如果被删除的是默认配置，自动将第一个配置设为默认；如果没有其他配置，`effectiveConfig` 为 null，走全部条目兜底
- **绑定配置不存在**：如果 `config_id` 指向的配置已被删除，`effectiveConfig` 查找失败，继续向下 fallback
- **迁移时角色/聊天不存在**：迁移时检查 `this_chid` 和 `characters[chid]` 是否存在，不存在则跳过角色/聊天层迁移
- **旧格式 entry_ids 兼容**：store 初始化时检测 configs 中是否存在旧格式 `entry_ids`，自动转换为 `entries` 格式（pinned/weight/condition 从 master_pool 查找对应值）

## 验证

```bash
pnpm build          # 类型检查 + 构建
npx vue-tsc --noEmit # 单独类型检查
```

浏览器验证：
1. 刷新酒馆页面，检查控制台无报错
2. 打开设置 → 条目池 tab，确认旧数据已迁移，配置下拉和条目库按钮正常显示
3. 点击"条目库"按钮，弹窗中增删改条目，AI 生成新条目
4. 点击"+ 新建"配置，弹窗中命名、勾选条目、设置抽取参数，保存
5. 下拉切换配置，点击"绑定聊天"/"绑定角色"绑定当前配置
6. 触发选项生成，确认使用了正确的配置和抽取参数
7. 解绑所有配置，确认走默认配置