# 简化选项规则字段 — 实现计划（含恢复默认功能）

## 目标

将 `core_rules` 提示词模块中的「人称/叙述风格」和「15条核心规则」提取为两个独立文本字段，放在"选项规则"标签页中，供新手用户直接编辑。每个字段标明对应模块，并提供恢复默认按钮（带确认弹窗）。提示词编辑器中每个模块也增加独立的恢复默认按钮（带确认弹窗）。

## 已完成的变更（前一轮）

| 文件 | 操作 |
|------|------|
| `src/type/settings.ts` | 新增 `CORE_RULES_STATIC`、`DEFAULT_PERSON_STYLE`、`DEFAULT_OPTION_RULES` 常量；Schema 新增 `person_style`/`option_rules` 字段；`SCHEMA_VERSION` 升到 12 |
| `src/core/generator.ts` | `core_rules` 分支动态组装，导入 `CORE_RULES_STATIC` |
| `src/components/BehaviorSettings.vue` | 新增两个 textarea 字段 |
| `src/components/FloatingSettings.vue` | 标签改名 |
| `src/components/SettingsPanel.vue` | 标签改名 |

## 新增需求

### 需求 1：每个简化字段标明对应模块
- "叙述风格" 字段 → 标注 "对应模块: core_rules"
- "选项规则" 字段 → 标注 "对应模块: core_rules"

### 需求 2：每个简化字段有恢复默认按钮（带确认弹窗）
- 点击恢复默认 → 弹出 ConfirmDialog → 确认后将字段重置为 `DEFAULT_PERSON_STYLE` 或 `DEFAULT_OPTION_RULES`

### 需求 3：提示词编辑器中每个模块有恢复默认按钮（带确认弹窗）
- 每个模块卡片的操作区增加"恢复默认"按钮（🔄 图标）
- 只读模块（marker）不显示
- 点击 → ConfirmDialog 确认 → 将模块 content 恢复为 `DEFAULT_MODULES` 中对应 id 的默认值
- `core_rules` 模块恢复时同步重置 `person_style` 和 `option_rules` 为默认值

---

## 待实现步骤

### 1. Store 新增 `resetModuleContent` 方法 (`src/store/global-settings.ts`)

在 `resetModuleOrder` 之后（约 line 496）添加：

```typescript
function resetModuleContent(id: string) {
  const modules = settings.value.prompt_rules.modules;
  const mod = modules.find(m => m.id === id);
  if (!mod || mod.marker) return;
  const defaults = klona(DEFAULT_MODULES);
  const defaultMod = defaults.find(m => m.id === id);
  if (!defaultMod) return;
  mod.content = defaultMod.content;
  // core_rules 模块内容恢复时，同步重置新手字段，保持一致性
  if (id === 'core_rules') {
    settings.value.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
    settings.value.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
  }
}
```

在文件顶部 import 中加入 `DEFAULT_PERSON_STYLE, DEFAULT_OPTION_RULES`。

在 return 对象中导出 `resetModuleContent`。

### 2. BehaviorSettings 增加模块标注和恢复按钮 (`src/components/BehaviorSettings.vue`)

**模板修改**：两个字段的 label 行改为 flex 布局，含模块标注 + 恢复默认按钮。新增两个 ConfirmDialog（一个用于叙述风格，一个用于选项规则）。

```vue
<template>
  <div class="choice-behavior-editor">
    <div class="choice-behavior-grid">
      <!-- 现有：自动生成 + 输入润色，保持不变 -->
    </div>

    <!-- 叙述风格 -->
    <div class="choice-field">
      <div class="choice-field-label">
        <label>{{ t`叙述风格` }}</label>
        <span class="choice-field-module">{{ t`对应模块: core_rules` }}</span>
        <button class="menu_button choice-restore-btn" @click="resetPersonStyleTarget = true">
          {{ t`恢复默认` }}
        </button>
      </div>
      <textarea v-model="globalStore.settings.prompt_rules.person_style" rows="3" class="text_pole"></textarea>
      <small class="choice-field-hint">{{ t`描述选项的叙述视角和人称要求，如"第三人称"、"第一人称女主视角"等` }}</small>
    </div>

    <!-- 选项规则 -->
    <div class="choice-field">
      <div class="choice-field-label">
        <label>{{ t`选项规则` }}</label>
        <span class="choice-field-module">{{ t`对应模块: core_rules` }}</span>
        <button class="menu_button choice-restore-btn" @click="resetOptionRulesTarget = true">
          {{ t`恢复默认` }}
        </button>
      </div>
      <textarea v-model="globalStore.settings.prompt_rules.option_rules" rows="10" class="text_pole"></textarea>
      <small class="choice-field-hint">{{ t`生成选项时 AI 必须遵守的核心规则，每行一条` }}</small>
    </div>

    <ConfirmDialog
      :open="resetPersonStyleTarget"
      :title="t`恢复默认`"
      :message="t`确定要将"叙述风格"恢复为默认值吗？当前修改将丢失。`"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onResetPersonStyleConfirm"
      @cancel="resetPersonStyleTarget = false"
    />
    <ConfirmDialog
      :open="resetOptionRulesTarget"
      :title="t`恢复默认`"
      :message="t`确定要将"选项规则"恢复为默认值吗？当前修改将丢失。`"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onResetOptionRulesConfirm"
      @cancel="resetOptionRulesTarget = false"
    />
  </div>
</template>
```

**script 修改**：

```typescript
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { DEFAULT_PERSON_STYLE, DEFAULT_OPTION_RULES } from '@/type/settings';

const resetPersonStyleTarget = ref(false);
const resetOptionRulesTarget = ref(false);

const onResetPersonStyleConfirm = () => {
  globalStore.settings.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
  resetPersonStyleTarget.value = false;
};
const onResetOptionRulesConfirm = () => {
  globalStore.settings.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
  resetOptionRulesTarget.value = false;
};
```

**CSS 新增**：

```css
.choice-field-label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.choice-field-label label {
  font-weight: 600;
}
.choice-field-module {
  font-size: 10px;
  color: var(--choice-text-muted);
  background: var(--choice-bg-card);
  padding: 1px 6px;
  border-radius: var(--choice-radius-full);
}
.choice-restore-btn {
  font-size: 11px;
  padding: 2px 8px;
  margin-left: auto;
}
```

### 3. PromptEditor 每个模块增加恢复默认按钮 (`src/components/PromptEditor.vue`)

**模板修改**：在 `.choice-module-actions` 中，复制按钮之前插入恢复默认按钮：

```vue
<div class="choice-module-actions">
  <label class="choice-module-toggle" ...>
    ...
  </label>
  <button
    v-if="!mod.marker"
    class="menu_button choice-module-btn"
    :title="t`恢复默认`"
    @click="restoreTarget = mod.id"
  >
    🔄
  </button>
  <button
    v-if="!READONLY_MODULE_IDS.has(mod.id)"
    class="menu_button choice-module-btn"
    :title="t`复制`"
    @click="copyModule(mod.id)"
  >
    📋
  </button>
  ...现有按钮...
</div>
```

模块列表末尾新增 ConfirmDialog（与已有的删除确认弹窗并列）：

```vue
<ConfirmDialog
  :open="restoreTarget !== null"
  :title="t`恢复默认`"
  :message="t`确定要将该模块恢复为默认内容吗？当前修改将丢失。`"
  :confirm-text="t`恢复`"
  :cancel-text="t`取消`"
  @confirm="onRestoreConfirm"
  @cancel="restoreTarget = null"
/>
```

**script 修改**：

```typescript
const restoreTarget = ref<string | null>(null);

const onRestoreConfirm = () => {
  if (restoreTarget.value) {
    globalStore.resetModuleContent(restoreTarget.value);
    restoreTarget.value = null;
  }
};
```

---

## 涉及文件

| 文件 | 操作 |
|------|------|
| `src/store/global-settings.ts` | 新增 `resetModuleContent` 方法 + 导入 `DEFAULT_PERSON_STYLE`/`DEFAULT_OPTION_RULES` + 导出 |
| `src/components/BehaviorSettings.vue` | 新增模块标注 + 恢复默认按钮（带 ConfirmDialog）+ 对应 import/ref/函数 |
| `src/components/PromptEditor.vue` | 每个模块新增恢复默认按钮（带 ConfirmDialog）+ 对应 ref/函数 |

## 验证步骤

1. `pnpm build` 确认无类型错误
2. 刷新酒馆页面 → 「选项规则」标签页
3. 确认每个字段有 `对应模块: core_rules` 标注和"恢复默认"按钮
4. 修改"叙述风格"内容 → 点击恢复默认 → 弹出确认弹窗 → 确认 → 内容恢复为默认值
5. 修改"叙述风格"内容 → 点击恢复默认 → 弹出确认弹窗 → 取消 → 内容不变
6. 切换到「提示词」标签页 → 找到 core_rules 模块 → 点击 🔄 → 确认 → 模块 content 恢复 + 回到「选项规则」确认两个字段也同步恢复
7. 对 system_prompt 模块点击 🔄 → 确认 → content 恢复为默认值
8. 确认只读模块（🔒标记）不显示 🔄 按钮