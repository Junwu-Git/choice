# 润色提示词模块化 + 选项标识

## 目标
1. 将固定的"润色提示词"卡片转为标准模块，融入模块列表（默认 order=3，位于 `user_instruction` 之后）
2. 为 `user_instruction`（生成指令）模块添加「选项」视觉标识，与「润色」标识区分
3. 润色模块受 `enrich_enabled` 开关控制可见性

## 改动文件

### 1. `src/type/settings.ts`
- `PromptModule` 新增 `option_only: z.boolean().default(false)` 字段
- `DEFAULT_MODULES` 中 `user_instruction` 增加 `option_only: true`
- `DEFAULT_MODULES` 新增 `enrich_prompt` 模块（order=3, `enrich_only: true`, 内容为默认润色提示词）
- 所有 order >= 3 的现有模块 order +1（reference_open 4→...assistant_thinking 15→16）
- `prompt_rules.schema_version` 从 8 升级到 9

### 2. `src/store/global-settings.ts`
- `migratePromptModules` 新增 v8→v9 迁移：
  - 给 `user_instruction` 模块设置 `option_only: true`
  - 若不存在 `enrich_prompt` 模块则创建，内容取 `enrich_prompt` 字段（为空则用默认值）
  - 将 order >= 3 的模块 order +1
  - 调用 `resetOrderFromDefaults` 统一顺序
  - 设置 `schema_version = 9`

### 3. `src/components/PromptEditor.vue`
- **模板**：
  - 删除固定"润色提示词"卡片（当前 185-199 行）
  - `allModules` computed 增加过滤：`enrich_enabled` 为 false 时过滤掉 `enrich_only` 模块
  - 模块卡片内新增「选项」badge：`v-if="mod.option_only"`，样式与「润色」badge 一致但颜色区分
  - `previewMessages` computed 增加过滤 `enrich_only` 模块（与 `generator.ts` 一致）
- **样式**：新增 `.choice-option-badge-sm` 类，颜色用暖色系（如橙/琥珀色）区分于润色的蓝色

### 4. `src/core/enrich-input.ts`
- 润色提示词读取逻辑改为：优先从 `enrich_prompt` 模块取内容，fallback 到 `enrich_prompt` 字段，再 fallback 到默认值

## 验证步骤
1. `pnpm build` 确保无类型错误
2. 浏览器刷新酒馆，打开提示词编辑界面
3. 确认"润色提示词"作为模块出现在列表中（order 3，`user_instruction` 之后）
4. 确认 `user_instruction` 模块显示「选项」badge
5. 确认润色模块显示「润色」badge
6. 关闭 `enrich_enabled` 开关，确认润色模块隐藏
7. 确认润色功能（润色输入框）仍正常工作
8. 确认行动选项生成功能不受影响

---

# 润色条数可配置

## 目标
润色生成的条数从硬编码 10 改为用户可手动填写的配置项。

## 改动文件

### 1. `src/type/settings.ts`
- `UISettings` 新增 `enrich_count: z.number().min(1).max(20).default(10)` 字段

### 2. `src/core/enrich-input.ts`
- 第 45 行：`enrichCtx = { count: gs.settings.ui.enrich_count, ... }`
- 第 63 行：`parseOptions(raw, gs.settings.ui.enrich_count)`

### 3. `src/components/BehaviorSettings.vue`
- 「输入润色」复选框同一行后面加数字输入框，绑定 `globalStore.settings.ui.enrich_count`
- 样式：小宽度（50px），`type="number"`，`min="1"` `max="20"`

## 验证步骤
1. `pnpm build` 确保无类型错误
2. 修改条数为 3，润色输入 → 确认生成 3 条
3. 修改条数为 15，润色输入 → 确认生成 15 条
4. 确认输入非法值时兜底正常（min/max 限制）