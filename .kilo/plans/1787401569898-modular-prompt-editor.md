# 模块化提示词编辑器 — 实施计划

## 目标

将当前固定 3 字段的 `PromptEditor.vue` 重构为模块化设计：每个 role 是独立模块，可拖拽排序、可复制、可编辑。参照酒馆 PromptManager 的预设结构，用 identifier 标识系统模块，用 `prompt_order` 数组控制顺序和启用状态。

## 设计决策

| 决策 | 结论 |
|------|------|
| 模块列表 | 7 个核心模块：system_prompt, World Info (before), Persona Description, World Info (after), Chat History, user_instruction, core_rules |
| 不可编辑模块 | World Info (before), Persona Description, World Info (after), Chat History（只可查看内容、移动、复制） |
| 世界书子项 | anBefore/em 合并到 World Info(before)；anAfter/atDepth 合并到 World Info(after) |
| 复制行为 | 独立副本，name 自动加 `-副本` 后缀 |
| Role 可改性 | 可编辑模块允许修改 role（system/user/assistant），Marker 模块锁定 |
| 拖拽 | 原生 HTML5 DnD（不引入第三方拖拽库） |
| context_rounds | 独立于模块列表，作为工具栏中的单独设置项 |
| THINKING/OPTIONS_PREFILL | 不受此次改动影响，仍由 `api.send_prefill` 开关控制 |
| 移除内容 | character.description, character.personality, character.scenario 从消息组装中移除 |
| 新增内容 | Persona Description（从 `power_user.persona_description` 读取） |

## 任务列表

### 任务 1：数据模型 — `src/type/settings.ts`

**新增 `PromptModule` 类型：**

```typescript
export const PromptModule = z.object({
  id: z.string(),           // 系统模块用固定 identifier（如 'system_prompt'），用户创建用 uuid
  name: z.string(),         // 显示名称
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().default(''),
  marker: z.boolean(),      // true=内容动态生成（世界书、Persona、聊天历史），不可编辑
  system: z.boolean(),      // true=系统模块，不可删除
  enabled: z.boolean().default(true),
  order: z.number().min(0),
});
export type PromptModule = z.infer<typeof PromptModule>;
```

**定义系统模块默认列表（7个）：**

| id | name | role | marker | system | 默认 content |
|---|---|---|---|---|---|
| `system_prompt` | 破限 | system | false | true | `DEFAULT_SYSTEM_PROMPT` |
| `world_info_before` | World Info (before) | system | true | true | `''`（动态生成） |
| `persona_description` | Persona Description | system | true | true | `''`（动态生成） |
| `world_info_after` | World Info (after) | system | true | true | `''`（动态生成） |
| `chat_history` | Chat History | system | true | true | `''`（动态生成） |
| `user_instruction` | 生成指令 | user | false | true | 默认指令模板（含 `{{count}}` `{{pinned}}` `{{pool_selected}}`） |
| `core_rules` | 规则 | system | false | true | `DEFAULT_CORE_RULES` |

**扩展 `PromptRules`：**

```typescript
export const PromptRules = z.object({
  // 保留旧字段用于迁移（设为 deprecated）
  system_prompt: z.string().default(''),
  core_rules: z.string().default(''),
  context_rounds: z.number().min(0).default(10),
  // 新增字段
  modules: z.array(PromptModule).prefault([]),
  schema_version: z.number().default(1),  // 0=旧格式，1=模块化格式
}).prefault({});
```

**默认 user_instruction 内容：**

```
请为角色的当前处境生成 {{count}} 条行动选项。
{{pinned}}
{{pool_selected}}

生成规则：
1. 其中 1 个固定为"跳过场景"类型
2. 其余 {{count_minus_1}} 个从以下类型中随机且互不重复地抽取，确保类型、切入点、情绪态度均有明显差异：理性分析、强势试探、温和安抚、幽默化解、纯物理行动、静观其变、视角切换、与此同时
3. 若当前候选类型总数不足以支撑本次抽取数量，允许类型重复，但重复类型生成的选项须在切入点与情绪态度上明显不同
4. 每个选项独立生成"标题"与"内容"两部分，格式约束见系统规则
5. 输出时严格遵守输出纯净度铁律，先输出 <thinking> 分析，再输出 <options> 选项
```

> 注意：`{{pinned}}` 和 `{{pool_selected}}` 为空时不显示，在 `buildUserInstr` 中由条件判断控制。迁移时将 `{{count_minus_1}}` 替换为 `{{count}}` 减 1 的逻辑留在 generator 中处理。

**向后兼容迁移函数：**

当 `schema_version < 1` 时，从旧的 `system_prompt`、`core_rules` 字段构建默认模块列表，写入 `modules` 并设置 `schema_version = 1`。

### 任务 2：生成器重构 — `src/core/generator.ts`

**重构 `buildMessages` 函数签名：**

```typescript
const buildMessages = async (
  modules: PromptModule[],      // 替换原来的 systemPrompt, userInstruction 等独立参数
  wi: WorldInfoGlobalSettings,
  wiChat: WorldInfoChatSettings,
  contextRounds: number,
): Promise<ChatMsg[]>
```

**新逻辑：遍历 modules 按 order 排序，对每个 module：**

```
for each module (sorted by order, enabled only):
  switch module.id:
    'system_prompt'    → push { role: module.role, content: sub(module.content, ctx) }
    'world_info_before' → if wi.enabled, buildWI → push { system, wiBuckets.before + anBefore + em }
    'persona_description' → if power_user.persona_description, push { system, substituteParams(desc) }
    'world_info_after'  → if wiEnabled, push { system, wiBuckets.after + anAfter + atDepth }
    'chat_history'       → for each history msg, push { role, content }
    'user_instruction'   → push { role: module.role, content: sub(module.content, ctx) }
    'core_rules'         → push { role: module.role, content: sub(module.content, ctx) }
    default (custom)     → push { role: module.role, content: sub(module.content, ctx) }
```

**移除的代码：**
- `character.description` 读取
- `character.personality` 读取
- `character.scenario` 读取
- `buildUserInstr` 函数（改为从 `user_instruction` 模块读取内容并替换占位符）

**新增 Persona 读取：**

```typescript
const personaDesc = (window as any).power_user?.persona_description;
if (personaDesc) {
  // 由 marker 模块 'persona_description' 触发时动态生成
  return substituteParams(personaDesc);
}
```

**保留 `buildUserInstr` 的占位符替换逻辑**，改为接收模块 content 字符串 + Ctx 对象，替换 `{{count}}`、`{{pinned}}`、`{{pool_selected}}`、`{{count_minus_1}}`（新增：`count - 1`）。

### 任务 3：UI 重构 — `src/components/PromptEditor.vue`

**整体布局：**

```
┌─────────────────────────────────────────────┐
│ 工具栏：[+ 新增模块] [重置顺序] [上下文轮数: ▢] [预览 ▾] │
├─────────────────────────────────────────────┤
│ ☰ 破限                  system  [🖉] [📋]    │
│ ☰ World Info (before)   system  [📋]  🔒    │
│ ☰ Persona Description   system  [📋]  🔒    │
│ ☰ World Info (after)    system  [📋]  🔒    │
│ ☰ Chat History          system  [📋]  🔒    │
│ ☰ 生成指令              user    [🖉] [📋]    │
│ ☰ 规则                  system  [🖉] [📋]    │
├─────────────────────────────────────────────┤
│ [预览区域]（折叠）                            │
└─────────────────────────────────────────────┘
```

**模块卡片设计：**

- 每行显示：拖拽手柄 ☰、模块名称（可编辑模块可双击改名）、role 标签、内容预览（前 80 字符）、操作按钮
- 不可编辑模块（marker=true）：内容预览区只读展开，🔒 图标
- 可编辑模块：点击编辑按钮 → 弹出 textarea 编辑 content 和 role 选择器
- 复制按钮 📋：创建独立副本（深拷贝，id 用 uuidv4，name 加 `-副本` 后缀）
- 删除按钮：仅非 system 模块可见
- 启用/禁用开关：所有模块都有

**拖拽实现：**

- 使用原生 HTML5 Drag and Drop API（`dragstart`、`dragover`、`drop`）
- 拖拽手柄作为 `draggable` 元素
- `dragover` 时计算插入位置，显示插入指示线
- `drop` 时更新 `modules` 数组中各模块的 `order` 字段
- 同时更新 Pinia store 持久化

**编辑弹窗：**

- 使用 `vue-final-modal`（项目已有依赖）或内联展开
- 可编辑模块：textarea 编辑 content + 下拉选择 role
- 不可编辑模块：只读展示 content 动态预览

**上下文轮数：**

- 独立于模块列表，放在工具栏中
- 保留现有的 number input + 预览按钮

**预览功能：**

- 保留现有 `previewMessages` computed，重构为基于模块列表动态生成
- 显示组装后的消息序列

### 任务 4：Store 改动 — `src/store/global-settings.ts`

**新增方法：**

```typescript
// 获取排序后的已启用模块列表
const sortedEnabledModules = computed(() => 
  store.settings.prompt_rules.modules
    .filter(m => m.enabled)
    .sort((a, b) => a.order - b.order)
);

// 获取默认模块列表
function getDefaultModules(): PromptModule[] { ... }

// 迁移旧格式
function migratePromptRules(): void { ... }

// 新增自定义模块
function addModule(): void { ... }

// 复制模块
function duplicateModule(id: string): void { ... }

// 删除模块（仅非 system）
function removeModule(id: string): void { ... }

// 更新模块顺序
function reorderModules(orderedIds: string[]): void { ... }

// 重置为默认顺序
function resetModuleOrder(): void { ... }
```

### 任务 5：World Info 合并

**`buildWI` 函数保持不变**，但 `buildMessages` 中的调用改为：

- `world_info_before` marker 模块解析时：`[wiBuckets.before, wiBuckets.anBefore, wiBuckets.em].filter(Boolean).join('\n\n')`
- `world_info_after` marker 模块解析时：`[wiBuckets.after, wiBuckets.anAfter, wiBuckets.atDepth].filter(Boolean).join('\n\n')`

### 任务 6：i18n 更新 — `i18n/en.json`

新增 key：
```json
{
  "新增模块": "Add Module",
  "重置顺序": "Reset Order",
  "复制": "Copy",
  "删除": "Delete",
  "模块名称": "Module Name",
  "角色": "Role",
  "内容": "Content",
  "启用": "Enabled",
  "双击编辑名称": "Double-click to edit name",
  "不可编辑模块": "Non-editable module",
  "World Info (before)": "World Info (before)",
  "World Info (after)": "World Info (after)",
  "Persona Description": "Persona Description",
  "Chat History": "Chat History",
  "生成指令": "Generation Instruction",
  "破限": "System Prompt",
  "规则": "Rules"
}
```

### 任务 7：样式

- 使用 Tailwind CSS 4（项目已有）
- 模块卡片：`flex items-center gap-2 p-2 border rounded`
- 拖拽手柄：`cursor-grab`
- 拖拽中：`opacity-50`
- 插入指示线：`border-t-2 border-blue-500`
- 不可编辑模块：`bg-gray-50` 半透明背景
- 参考现有 `PromptEditor.vue` 的 CSS 类命名风格（`choice-*` 前缀）

### 任务 8：构建验证

```bash
pnpm build          # 确保 TypeScript 编译和 Vite 打包通过
npx vue-tsc --noEmit  # 类型检查
```

浏览器验证步骤：
1. 刷新酒馆页面
2. 打开扩展设置 → 提示词编辑标签
3. 确认 7 个模块按默认顺序显示
4. 拖拽 reorder 模块，确认顺序更新
5. 复制一个模块，确认副本出现且可独立编辑
6. 编辑 system_prompt 模块内容，确认保存
7. 切换角色/聊天，确认模块列表持久化
8. 触发一次选项生成，在 Network 面板确认消息顺序正确
9. 在预览区域确认消息组装顺序与模块列表一致