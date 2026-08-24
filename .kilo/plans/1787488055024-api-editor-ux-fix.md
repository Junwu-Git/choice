# API 编辑器重构计划（第三轮）

前两轮（`active_api_id` 迁移 + 按钮下移 + 编辑创建新条目 + 模型下拉）已实现，但用户反馈交互仍不合理。本轮全面重构为**单选表单**模式。

---

## 问题 5: 卡片列表 → 单选表单

**用户的三个核心诉求**:

1. "生成API为何不固定现在启用的API" — 下拉框应始终显示当前启用的 API
2. "保存后的模型，为何要在下面全显示？" — 不应该有 API 卡片列表
3. "我切到API1就显示API1的配置，切到API2就显示API2的配置。不要并列存在" — 单个表单，跟随下拉框切换

### 目标架构

```
[生成 API 下拉框: ▼ GPT-4o]          ← 始终显示当前 active_api_id
┌─────────────────────────────────────┐
│ 配置名称: [GPT-4o                  ]│
│ API 地址: [https://...            ] │
│ API 密钥: [****                   ] │
│ 模型名称: [gpt-4o    ] [拉取] [▾]  │
│ (点击 ▾ 展开模型列表)               │
│ 温度: [1.0] 最大Token: [4096] 超时: [0] │
│ ☐流式 ☐预填充  排除参数: [...]      │
│                              [🗑删除]│
└─────────────────────────────────────┘
[保存] [取消]
```

### 核心数据流

```ts
// 状态
const selectedApiId = ref<string>(globalStore.settings.active_api_id);
const draftForm = ref<SecondaryApi>(initForm());
const modelDropdownOpen = ref(false);  // 单值，不再按卡片 ID

// 初始化表单：根据 selectedApiId 查找对应 API 并深拷贝
const initForm = (): SecondaryApi => {
  const api = globalStore.settings.apis.find(a => a.id === selectedApiId.value);
  return api ? klona(api) : EMPTY_API();
};

// 切换 API：下拉框 change 事件触发
const selectApi = (id: string) => {
  selectedApiId.value = id;
  const api = globalStore.settings.apis.find(a => a.id === id);
  draftForm.value = api ? klona(api) : EMPTY_API();
  modelDropdownOpen.value = false;
};
```

### 各操作逻辑

**保存**:
1. 在 `globalStore.settings.apis` 中查找 `selectedApiId` 对应的原始条目
2. 对比 `draftForm` 与原始条目（`_.isEqual`）
3. 如果不同 → 创建新条目（新 ID），保留原始条目；`active_api_id` 设为新 ID
4. 如果相同 → 无操作
5. 如果无对应原始条目（空列表）→ 直接新增
6. 保存后重置 `draftForm` 为新条目，`selectedApiId` 切换到新 ID

**取消**:
1. `selectedApiId` 重置为 `globalStore.settings.active_api_id`
2. `draftForm` 重置为对应 API 的深拷贝（或空表单）
3. `modelDropdownOpen` 重置为 false

**删除**（表单内删除按钮）:
1. 从 `globalStore.settings.apis` 中移除当前选中的 API
2. 如果删除的是 `active_api_id`，将 `active_api_id` 设为列表中第一个 API 的 ID（或空）
3. `selectedApiId` 切换到下一个可用 API（或空）
4. `draftForm` 重置为对应 API 的深拷贝（或空表单）

### 模板改动

**移除**:
- `v-for="api in draftApis"` 卡片列表
- `.choice-api-card`、`.choice-api-head`、`.choice-api-card-body` 等卡片相关样式
- `expandedCards`、`toggleCard`、`draftApis`、`originalApis`、`initDraft` 等卡片相关变量/函数

**新增**:
- 单个表单区域（`.choice-api-form`），直接绑定 `draftForm`
- 表单内删除按钮（右上角）
- 下拉框改为 `@change="selectApi($event.target.value)"` 替代 `v-model`

**保留**:
- "生成 API" 下拉框
- 模型输入框 + 拉取按钮 + 下拉按钮 + 模型列表
- 底部保存/取消按钮

### 脚本改动

**移除的变量/函数**: `draftApis`, `originalApis`, `initDraft`, `expandedCards`, `toggleCard`, `removeApi`（旧版）

**新增的变量/函数**: `selectedApiId`, `draftForm`, `initForm`, `selectApi`

**修改的函数**: `save`, `reset`, `removeApi`（新版签名不同）, `fetchModels`（参数改为 `draftForm`）

**简化的变量**: `modelDropdownOpen` 从 `Record<string, boolean>` 改为 `boolean`

### 样式改动

**移除**: `.choice-api-card`, `.choice-api-head`, `.choice-api-head:hover`, `.choice-api-card-title`, `.choice-api-card-model`, `.choice-api-card-body`, `.choice-icon-btn`, `.choice-icon-btn:hover`

**新增**: `.choice-api-form`（替代卡片容器）, `.choice-api-delete-btn`（删除按钮样式）

**保留**: 表单内各字段样式、模型列表样式、底部按钮样式

---

## 最终布局

```
[生成 API 下拉框: ▼ GPT-4o]
┌─────────────────────────────────────┐
│ 配置名称: [GPT-4o                  ]│
│ API 地址: [https://...            ] │
│ API 密钥: [****                   ] │
│ 模型名称: [gpt-4o    ] [拉取] [▾]  │
│ ┌─ 可用模型 ─────────────────────┐  │
│ │ gpt-4o                 ← 选中  │  │
│ │ gpt-4-turbo                   │  │
│ └───────────────────────────────┘  │
│ 温度: [1.0] 最大Token: [4096] 超时: [0] │
│ ☐流式 ☐预填充  排除参数: [...]      │
│                              [🗑删除]│
└─────────────────────────────────────┘
[保存] [取消]
```

---

## 验证方式

1. `pnpm build` 确保无编译/类型错误
2. 刷新酒馆网页，打开扩展设置 → API 编辑页
3. **下拉固定**: 确认下拉框显示当前启用的 API（`active_api_id` 持久化）
4. **切换表单**: 切换下拉框选择不同 API → 表单切换显示对应配置
5. **编辑创建新条目**: 修改名称/模型，保存 → 下拉框切换到新条目，原条目保留在选项中
6. **删除**: 点击表单内删除按钮 → 当前 API 被删除，切换到下一个可用 API
7. **取消**: 切换下拉框并修改表单，点取消 → 下拉框和表单都恢复为已保存状态
8. **模型下拉**: 拉取模型后点击 [▾] 展开列表，点击模型选中并自动收起