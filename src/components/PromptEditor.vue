<template>
  <div class="choice-prompt-editor">
    <div class="choice-prompt-toolbar">
      <div class="choice-prompt-toolbar-left">
        <button class="menu_button" :title="t`添加新的提示词模块`" @click="addModule">{{ t`新增模块` }}</button>
        <button
          v-if="globalStore.settings.ui.enrich_enabled"
          class="menu_button"
          :title="t`添加润色专用的提示词模块`"
          @click="addEnrichModule"
        >
          {{ t`新增润色模块` }}
        </button>
        <div class="choice-export-wrap">
          <button
            class="menu_button choice-export-btn"
            :title="t`选择要导出的模块范围`"
            @click.stop="showExportMenu = !showExportMenu"
          >
            <span>{{ t`导出` }}</span>
            <i class="fa-solid fa-chevron-down choice-export-caret" :class="{ 'choice-export-caret--open': showExportMenu }"></i>
          </button>
          <div v-if="showExportMenu" class="choice-export-dropdown">
            <button
              @click="
                exportPrompts('all');
                showExportMenu = false;
              "
            >
              {{ t`导出全部` }}
            </button>
            <button
              @click="
                exportPrompts('option');
                showExportMenu = false;
              "
            >
              {{ t`导出选项模块` }}
            </button>
            <button
              v-if="globalStore.settings.ui.enrich_enabled"
              @click="
                exportPrompts('enrich');
                showExportMenu = false;
              "
            >
              {{ t`导出润色模块` }}
            </button>
          </div>
        </div>
        <button class="menu_button" :title="t`从 JSON 文件导入提示词模块`" @click="importPrompts">
          {{ t`导入` }}
        </button>
      </div>
      <div class="choice-prompt-toolbar-right">
        <label class="choice-context-rounds" :title="t`轮数模式：取最后 N 轮；仅可见消息：不限轮数，排除隐藏消息`">
          <select v-model="rules.context_mode" class="text_pole" style="width: auto">
            <option value="rounds">{{ t`轮数模式` }}</option>
            <option value="visible_only">{{ t`仅可见消息` }}</option>
          </select>
          <input
            v-if="rules.context_mode === 'rounds'"
            v-model.number="rules.context_rounds"
            class="text_pole"
            type="number"
            min="0"
            style="width: 60px"
          />
        </label>
        <label class="choice-context-rounds" :title="t`关闭后不发送 assistant 预填充消息，兼容不支持 prefill 的模型`">
          <input v-model="rules.prefill_enabled" type="checkbox" />
          {{ t`预填充` }}
        </label>
        <label class="choice-context-rounds" :title="t`开启后启用柏宝书记忆源（摘要+状态）作为提示词模块`">
          <input v-model="rules.baibai_enabled" type="checkbox" />
          {{ t`柏宝书` }}
        </label>
        <button
          class="menu_button"
          :title="showPreview ? t`隐藏预览` : t`显示当前提示词组装预览`"
          @click="togglePreview"
        >
          <i class="fa-solid" :class="showPreview ? 'fa-eye-slash' : 'fa-eye'"></i>
          {{ showPreview ? t`隐藏预览` : t`预览` }}
        </button>
        <button
          class="menu_button"
          :title="t`将所有提示词模块完全恢复为默认值（包括顺序、启用状态、内容）`"
          @click="resetPromptToDefaults"
        >
          {{ t`恢复默认` }}
        </button>
      </div>
    </div>

    <div v-if="globalStore.settings.ui.enrich_enabled" class="choice-mode-switch">
      <button
        class="choice-mode-btn"
        :class="{ 'choice-mode-btn--active': promptMode === 'all' }"
        @click="promptMode = 'all'"
      >
        {{ t`全部` }} ({{ totalCount }})
      </button>
      <button
        class="choice-mode-btn"
        :class="{ 'choice-mode-btn--active': promptMode === 'option' }"
        @click="promptMode = 'option'"
      >
        {{ t`选项生成` }} ({{ optionCount }})
      </button>
      <button
        class="choice-mode-btn"
        :class="{ 'choice-mode-btn--active': promptMode === 'enrich' }"
        @click="promptMode = 'enrich'"
      >
        {{ t`润色` }} ({{ enrichCount }})
      </button>
    </div>

    <div class="choice-beginner-section">
      <div class="choice-filter-header" @click="showBeginner = !showBeginner">
        <i class="fa-solid" :class="showBeginner ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        <span>{{ t`新手快捷编辑` }}</span>
        <span class="choice-field-module">{{ t`对应模块: core_rules` }}</span>
      </div>
      <div v-if="showBeginner" class="choice-beginner-body">
        <div class="choice-field">
          <div class="choice-field-label">
            <label>{{ t`叙述风格` }}</label>
            <button class="menu_button choice-restore-btn" @click="resetPersonStyleTarget = true">
              {{ t`恢复默认` }}
            </button>
          </div>
          <textarea v-model="globalStore.settings.prompt_rules.person_style" rows="3" class="text_pole"></textarea>
          <small class="choice-field-hint">{{
            t`描述选项的叙述视角和人称要求，如"第三人称"、"第一人称女主视角"等`
          }}</small>
        </div>
        <div class="choice-field">
          <div class="choice-field-label">
            <label>{{ t`选项规则` }}</label>
            <button class="menu_button choice-restore-btn" @click="resetOptionRulesTarget = true">
              {{ t`恢复默认` }}
            </button>
          </div>
          <textarea v-model="globalStore.settings.prompt_rules.option_rules" rows="10" class="text_pole"></textarea>
          <small class="choice-field-hint">{{ t`生成选项时 AI 必须遵守的核心规则，每行一条` }}</small>
        </div>
      </div>
    </div>

    <div class="choice-filter-section">
      <div class="choice-filter-header" @click="showFilter = !showFilter">
        <i class="fa-solid" :class="showFilter ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        <span>{{ t`聊天记录过滤` }}</span>
      </div>
      <div v-if="showFilter" class="choice-filter-body">
        <p class="choice-filter-desc">{{ t`过滤聊天记录中标签包裹或匹配正则的内容（如思维链、小剧场、防截断等）` }}</p>
        <div v-for="group in rules.chat_filter_groups" :key="group.id" class="choice-filter-group">
          <div class="choice-filter-group-header" @click="toggleGroup(group.id)">
            <i
              class="fa-solid choice-filter-group-caret"
              :class="groupExpanded[group.id] ? 'fa-chevron-down' : 'fa-chevron-right'"
            ></i>
            <span
              v-if="groupRenameId !== group.id"
              class="choice-filter-group-name"
              >{{ group.name }}</span
            >
            <input
              v-else
              ref="groupRenameInput"
              v-model="groupRenameText"
              class="text_pole"
              style="width: 100px; font-size: var(--choice-text-xs); flex-shrink: 0"
              @keydown.enter="finishGroupRename(group)"
              @keydown.escape="cancelGroupRename"
              @click.stop
            />
            <button
              class="menu_button choice-filter-del"
              :title="groupRenameId === group.id ? t`保存` : t`重命名`"
              @click.stop="groupRenameId === group.id ? finishGroupRename(group) : startGroupRename(group)"
            >
              <i :class="groupRenameId === group.id ? 'fa-solid fa-check' : 'fa-solid fa-pen-to-square'"></i>
            </button>
            <button
              v-if="groupRenameId === group.id"
              class="menu_button choice-filter-del"
              :title="t`取消`"
              @click.stop="cancelGroupRename"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
            <label class="choice-module-toggle" :title="group.enabled ? t`启用` : t`禁用`" @click.stop>
              <input type="checkbox" :checked="group.enabled" @change="group.enabled = !group.enabled" />
            </label>
            <button class="menu_button choice-filter-del" :title="t`新增规则`" @click.stop="addFilterRule(group.id)">
              +
            </button>
            <button class="menu_button choice-filter-del" :title="t`删除分组`" @click.stop="deleteGroupTarget = group.id">
              <i class="fa-solid fa-trash" style="color: var(--choice-color-error)"></i>
            </button>
          </div>
          <div v-if="groupExpanded[group.id]" class="choice-filter-group-body">
            <div v-for="(rule, idx) in group.rules" :key="idx" class="choice-filter-row">
              <select v-model="rule.type" class="text_pole choice-filter-type">
                <option value="tag">{{ t`标签匹配` }}</option>
                <option value="regex">{{ t`正则表达式` }}</option>
              </select>
              <template v-if="rule.type === 'tag'">
                <input v-model="rule.start" class="text_pole" :placeholder="t`标签头`" />
                <input v-model="rule.end" class="text_pole" :placeholder="t`标签尾`" />
              </template>
              <input v-else v-model="rule.pattern" class="text_pole" :placeholder="t`正则表达式`" />
              <button class="menu_button choice-filter-del" @click="removeFilterRule(group.id, idx)">✕</button>
            </div>
          </div>
        </div>
        <button class="menu_button" @click="addFilterGroup">{{ t`新增分组` }}</button>
      </div>
    </div>

    <div class="choice-module-list" @dragover.prevent="onListDragOver" @drop.prevent="onListDrop">
      <template v-for="(mod, idx) in allModules" :key="mod.id">
        <div
          class="choice-module-card"
          :class="{
            'choice-module-card-marker': mod.marker,
            'choice-module-card-dragging': dragIndex === idx,
            'choice-module-card-drag-over': dragOverIndex === idx && dragIndex !== idx,
          }"
          :draggable="true"
          @dragstart="onDragStart($event, idx)"
          @dragover.prevent="onDragOver($event, idx)"
          @dragleave="onDragLeave(idx)"
          @drop.prevent="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <span class="choice-module-drag" :draggable="true">☰</span>

          <div class="choice-module-body">
            <div class="choice-module-header">
              <span v-if="renamingId !== mod.id" class="choice-module-name" @dblclick="startRename(mod)">{{
                mod.name
              }}</span>
              <input
                v-else
                ref="renameInput"
                v-model="renameText"
                class="text_pole choice-rename-input"
                @blur="finishRename(mod)"
                @keydown.enter="finishRename(mod)"
                @keydown.escape="cancelRename"
              />
              <span class="choice-module-role" :class="`choice-role-${mod.role}`">{{ mod.role }}</span>
              <span v-if="mod.enrich_only" class="choice-enrich-badge-sm">{{ t`润色` }}</span>
              <span v-if="mod.option_only" class="choice-option-badge-sm">{{ t`选项` }}</span>
              <span v-if="mod.marker" class="choice-module-lock" :title="t`不可编辑模块`">🔒</span>
            </div>
            <div class="choice-module-preview">
              {{ previewContent(mod) }}
            </div>
          </div>

          <div class="choice-module-actions">
            <label class="choice-module-toggle" :title="mod.enabled ? t`启用` : t`禁用`">
              <input type="checkbox" :checked="mod.enabled" @change="toggleEnabled(mod)" />
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
            <button
              v-if="!mod.marker"
              class="menu_button choice-module-btn"
              :title="t`编辑`"
              @click="toggleEdit(mod.id)"
            >
              {{ editingId === mod.id ? '✕' : '🖉' }}
            </button>
            <button
              v-if="!mod.system"
              class="menu_button choice-module-btn"
              :title="t`删除`"
              @click="deleteTarget = mod.id"
            >
              <i class="fa-solid fa-trash" style="color: var(--choice-color-error)"></i>
            </button>
          </div>
        </div>

        <div v-if="editingId === mod.id" class="choice-module-edit">
          <div class="choice-module-edit-head">
            <span>{{ t`编辑模块` }}: {{ editingModule?.name }}</span>
            <select v-if="editingModule" v-model="editingModule.role" class="text_pole" style="width: auto">
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
          </div>
          <textarea v-if="editingModule" v-model="editingModule.content" class="text_pole" rows="8"></textarea>
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="t`删除模块`"
      :message="t`确定要删除该模块吗？此操作不可撤销。`"
      :confirm-text="t`删除`"
      :cancel-text="t`取消`"
      @confirm="onDeleteConfirm"
      @cancel="deleteTarget = null"
    />

    <ConfirmDialog
      :open="deleteGroupTarget !== null"
      :title="t`删除分组`"
      :message="t`确定要删除该分组及其所有规则吗？此操作不可撤销。`"
      :confirm-text="t`删除`"
      :cancel-text="t`取消`"
      @confirm="onDeleteGroupConfirm"
      @cancel="deleteGroupTarget = null"
    />

    <ConfirmDialog
      :open="restoreTarget !== null"
      :title="t`恢复默认`"
      :message="t`确定要将该模块恢复为默认内容吗？当前修改将丢失。`"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onRestoreConfirm"
      @cancel="restoreTarget = null"
    />

    <ConfirmDialog
      :open="resetPersonStyleTarget"
      :title="t`恢复默认`"
      :message="resetPersonStyleMsg"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onResetPersonStyleConfirm"
      @cancel="resetPersonStyleTarget = false"
    />
    <ConfirmDialog
      :open="resetOptionRulesTarget"
      :title="t`恢复默认`"
      :message="resetOptionRulesMsg"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onResetOptionRulesConfirm"
      @cancel="resetOptionRulesTarget = false"
    />

    <div v-if="showPreview" class="choice-preview-box">
      <div v-if="previewMessages.length === 0" class="choice-preview-empty">
        {{ t`暂无聊天历史` }}
      </div>
      <div
        v-for="(msg, i) in previewMessages"
        :key="i"
        class="choice-preview-msg"
        :class="`choice-preview-${msg.role}`"
      >
        <span class="choice-preview-role">{{ msg.role.toUpperCase() }}</span>
        <pre class="choice-preview-content">{{ msg.content }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import type { PromptModule, ChatFilterGroup } from '@/type/settings';
import { BAIBAI_MODULE_IDS, DEFAULT_PERSON_STYLE, DEFAULT_OPTION_RULES } from '@/type/settings';
import { PromptModule as PromptModuleSchema } from '@/type/settings';
import { z } from 'zod';
import { chat, characters, this_chid } from '@sillytavern/script';
import { uuidv4 } from '@sillytavern/scripts/utils';

const globalStore = useGlobalSettingsStore();
const rules = globalStore.settings.prompt_rules;

/** 只读模块：仅允许移动和开关，不可编辑/删除/复制 */
const READONLY_MODULE_IDS = new Set([
  'world_info_before',
  'persona_description',
  'char_description',
  'char_personality',
  'char_scenario',
  'world_info_after',
  'chat_history',
  'baibai_summary',
  'baibai_state',
]);

const allModules = computed(() => {
  let modules = globalStore.allModules;
  if (!rules.baibai_enabled) {
    modules = modules.filter(m => !BAIBAI_MODULE_IDS.has(m.id));
  }
  // 润色关闭时强制隐藏所有 enrich_only 模块，忽略 promptMode
  if (!globalStore.settings.ui.enrich_enabled) {
    modules = modules.filter(m => !m.enrich_only);
  } else if (promptMode.value === 'option') {
    modules = modules.filter(m => !m.enrich_only);
  } else if (promptMode.value === 'enrich') {
    modules = modules.filter(m => !m.option_only);
  }
  return modules;
});

type PromptMode = 'all' | 'option' | 'enrich';
const promptMode = ref<PromptMode>('all');
const showExportMenu = ref(false);

const baibaiFilteredModules = computed(() => {
  if (!rules.baibai_enabled) {
    return globalStore.allModules.filter(m => !BAIBAI_MODULE_IDS.has(m.id));
  }
  return globalStore.allModules;
});

const totalCount = computed(() => baibaiFilteredModules.value.length);
const optionCount = computed(() => baibaiFilteredModules.value.filter(m => !m.enrich_only).length);
const enrichCount = computed(() => baibaiFilteredModules.value.filter(m => !m.option_only).length);

watch(
  () => globalStore.settings.ui.enrich_enabled,
  enabled => {
    if (!enabled) promptMode.value = 'all';
  },
);

const showPreview = ref(false);
const showFilter = ref(false);
const showBeginner = ref(false);
const editingId = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameText = ref('');
const deleteTarget = ref<string | null>(null);
const deleteGroupTarget = ref<string | null>(null);
const restoreTarget = ref<string | null>(null);
const resetPersonStyleTarget = ref(false);
const resetOptionRulesTarget = ref(false);
const groupExpanded = ref<Record<string, boolean>>({});
const groupRenameId = ref<string | null>(null);
const groupRenameText = ref('');

const editingModule = computed(() => {
  if (!editingId.value) return null;
  return rules.modules.find(m => m.id === editingId.value) ?? null;
});

const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const addModule = () => {
  globalStore.addModule();
};

const addEnrichModule = () => {
  globalStore.addModule(undefined, true);
};

const resetPromptToDefaults = () => {
  if (!confirm(t`确定要将所有提示词模块完全恢复为默认值吗？\n\n这将重置模块顺序、启用状态和内容。此操作不可撤销。`))
    return;
  globalStore.resetPromptToDefaults();
  toastr.success(t`提示词已恢复为默认值`);
};

function exportPrompts(mode: 'all' | 'option' | 'enrich' = 'all') {
  let modules = globalStore.settings.prompt_rules.modules;
  if (mode === 'option') {
    modules = modules.filter(m => !m.enrich_only);
  } else if (mode === 'enrich') {
    modules = modules.filter(m => !m.option_only);
  }
  const json = JSON.stringify(
    {
      version: 2,
      mode,
      exportedAt: new Date().toISOString(),
      modules,
    },
    null,
    2,
  );
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = mode !== 'all' ? `-${mode}` : '';
  a.download = `choice-prompts${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importPrompts() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.modules || !Array.isArray(data.modules)) {
        throw new Error('JSON 文件格式不正确：缺少 modules 数组');
      }
      const importedModules = z.array(PromptModuleSchema).parse(data.modules);
      const ids = importedModules.map(m => m.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error('导入的模块中存在重复 ID');
      }
      const mode: string = data.mode || 'all';
      const existingModules = globalStore.settings.prompt_rules.modules;

      if (mode === 'all') {
        if (!confirm(t`确定要导入 ${importedModules.length} 个提示词模块吗？这将替换当前所有模块。`)) return;
        globalStore.settings.prompt_rules.modules = importedModules;
      } else if (mode === 'option') {
        const kept = existingModules.filter(m => m.enrich_only);
        if (!confirm(t`将导入 ${importedModules.length} 个选项模块，保留现有 ${kept.length} 个润色模块。确定继续？`))
          return;
        globalStore.settings.prompt_rules.modules = [...importedModules, ...kept];
      } else if (mode === 'enrich') {
        const kept = existingModules.filter(m => m.option_only);
        if (!confirm(t`将导入 ${importedModules.length} 个润色模块，保留现有 ${kept.length} 个选项模块。确定继续？`))
          return;
        globalStore.settings.prompt_rules.modules = [...importedModules, ...kept];
      } else {
        throw new Error(`未知的导入模式：${mode}`);
      }
      toastr.success(t`已导入 ${importedModules.length} 个提示词模块`);
    } catch (err) {
      toastr.error(t`导入失败：${err instanceof Error ? err.message : '无效的 JSON 文件'}`);
    }
  };
  input.click();
}

const addFilterGroup = () => {
  const group: ChatFilterGroup = {
    id: uuidv4(),
    name: '新分组',
    enabled: true,
    rules: [],
  };
  rules.chat_filter_groups.push(group);
  groupExpanded.value[group.id] = true;
};

const removeFilterGroup = (id: string) => {
  const idx = rules.chat_filter_groups.findIndex(g => g.id === id);
  if (idx !== -1) rules.chat_filter_groups.splice(idx, 1);
};

const onDeleteGroupConfirm = () => {
  if (deleteGroupTarget.value) {
    removeFilterGroup(deleteGroupTarget.value);
    deleteGroupTarget.value = null;
  }
};

const toggleGroup = (id: string) => {
  groupExpanded.value[id] = !groupExpanded.value[id];
};

const addFilterRule = (groupId: string) => {
  const group = rules.chat_filter_groups.find(g => g.id === groupId);
  if (group) {
    group.rules.push({ type: 'tag', start: '', end: '' });
    groupExpanded.value[groupId] = true;
  }
};

const removeFilterRule = (groupId: string, idx: number) => {
  const group = rules.chat_filter_groups.find(g => g.id === groupId);
  if (group) {
    group.rules.splice(idx, 1);
  }
};

const startGroupRename = (group: ChatFilterGroup) => {
  groupRenameId.value = group.id;
  groupRenameText.value = group.name;
};

const finishGroupRename = (group: ChatFilterGroup) => {
  const t = groupRenameText.value.trim();
  if (t) group.name = t;
  groupRenameId.value = null;
};

const cancelGroupRename = () => {
  groupRenameId.value = null;
};

const toggleEnabled = (mod: PromptModule) => {
  mod.enabled = !mod.enabled;
};

const copyModule = (id: string) => {
  globalStore.duplicateModule(id);
};

const onDeleteConfirm = () => {
  if (deleteTarget.value) {
    globalStore.removeModule(deleteTarget.value);
    deleteTarget.value = null;
  }
};

const onRestoreConfirm = () => {
  if (restoreTarget.value) {
    globalStore.resetModuleContent(restoreTarget.value);
    restoreTarget.value = null;
  }
};

const toggleEdit = (id: string) => {
  editingId.value = editingId.value === id ? null : id;
};

const startRename = (mod: PromptModule) => {
  renamingId.value = mod.id;
  renameText.value = mod.name;
};

const finishRename = (mod: PromptModule) => {
  const t = renameText.value.trim();
  if (t) mod.name = t;
  renamingId.value = null;
};

const cancelRename = () => {
  renamingId.value = null;
};

const previewContent = (mod: PromptModule): string => {
  if (mod.marker) {
    const m: Record<string, string> = {
      world_info_before: '[世界书条目 - 角色定义前]',
      world_info_after: '[世界书条目 - 角色定义后]',
      persona_description: '[Persona 描述]',
      chat_history: '[聊天历史]',
      assistant_ack: '[AI 应答开头]',
      thinking_prompt: '[思考检查清单]',
      assistant_thinking: '[思维链开头]',
    };
    return m[mod.id] ?? '[动态内容]';
  }
  const t = mod.content.replace(/\{\{[^}]+\}\}/g, '...').slice(0, 80);
  return t || '(空)';
};

const onDragStart = (e: DragEvent, idx: number) => {
  dragIndex.value = idx;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
  }
};

const onDragOver = (_e: DragEvent, idx: number) => {
  if (dragIndex.value === null) return;
  dragOverIndex.value = idx;
};

const onDragLeave = (idx: number) => {
  if (dragOverIndex.value === idx) dragOverIndex.value = null;
};

const onListDragOver = (_e: DragEvent) => {
  // 允许 drop
};

const onListDrop = (_e: DragEvent) => {
  dragIndex.value = null;
  dragOverIndex.value = null;
};

const onDrop = (idx: number) => {
  if (dragIndex.value === null || dragIndex.value === idx) {
    dragIndex.value = null;
    dragOverIndex.value = null;
    return;
  }
  const all = [...allModules.value];
  const [moved] = all.splice(dragIndex.value, 1);
  all.splice(idx, 0, moved);
  globalStore.reorderModules(all.map(m => m.id));
  dragIndex.value = null;
  dragOverIndex.value = null;
};

const onDragEnd = () => {
  dragIndex.value = null;
  dragOverIndex.value = null;
};

const togglePreview = () => {
  showPreview.value = !showPreview.value;
};

type PreviewMsg = { role: string; content: string };

const previewMessages = computed<PreviewMsg[]>(() => {
  if (!showPreview.value) return [];
  const msgs: PreviewMsg[] = [];
  const sorted = [...rules.modules].filter(m => m.enabled && !m.enrich_only).sort((a, b) => a.order - b.order);

  for (const mod of sorted) {
    // 预填充关闭时跳过 assistant 角色模块，与 generator.ts 保持一致
    if (!rules.prefill_enabled && mod.role === 'assistant') continue;
    switch (mod.id) {
      case 'system_prompt':
        if (mod.content) msgs.push({ role: mod.role, content: mod.content.slice(0, 200) + '...' });
        break;
      case 'world_info_before':
        msgs.push({ role: 'system', content: '[World Info (before) + anchor before + EM]' });
        break;
      case 'persona_description':
        msgs.push({ role: 'system', content: '[Persona Description]' });
        break;
      case 'world_info_after':
        msgs.push({ role: 'system', content: '[World Info (after) + anchor after + atDepth]' });
        break;
      case 'chat_history': {
        let history = chat.filter(m => !m.is_hidden);
        if (rules.context_rounds > 0) history = history.slice(-rules.context_rounds * 2);
        for (const m of history) {
          if (m.is_system) continue;
          const c = m.mes ?? '';
          if (!c) continue;
          // 预填充关闭时，聊天历史转为 system 角色，与 generator.ts 保持一致
          const role = rules.prefill_enabled ? (m.is_user ? 'user' : 'assistant') : 'system';
          msgs.push({
            role,
            content: c.slice(0, 200) + (c.length > 200 ? '...' : ''),
          });
        }
        break;
      }
      case 'user_instruction':
        if (mod.content) msgs.push({ role: mod.role, content: mod.content.slice(0, 200) + '...' });
        break;
      case 'core_rules':
        if (mod.content) msgs.push({ role: mod.role, content: mod.content.slice(0, 150) + '...' });
        break;
      default:
        if (mod.content) msgs.push({ role: mod.role, content: mod.content.slice(0, 200) + '...' });
        break;
    }
  }

  const merged: PreviewMsg[] = [];
  for (const msg of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content = last.content + '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
});

const onResetPersonStyleConfirm = () => {
  globalStore.settings.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
  resetPersonStyleTarget.value = false;
};
const onResetOptionRulesConfirm = () => {
  globalStore.settings.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
  resetOptionRulesTarget.value = false;
};
const resetPersonStyleMsg = computed(() => t`确定要将"叙述风格"恢复为默认值吗？当前修改将丢失。`);
const resetOptionRulesMsg = computed(() => t`确定要将"选项规则"恢复为默认值吗？当前修改将丢失。`);

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.choice-export-wrap')) {
    showExportMenu.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
});
</script>

<style scoped>
.choice-prompt-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-prompt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-prompt-toolbar-left,
.choice-prompt-toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-context-rounds {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-module-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  min-height: 40px;
}

.choice-module-card {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  cursor: default;
  transition:
    border-color var(--choice-transition),
    box-shadow var(--choice-transition),
    transform var(--choice-transition);
  user-select: none;
}

.choice-module-card:hover {
  border-color: var(--choice-border-strong);
}

.choice-module-card-marker {
  border-style: dashed;
  background: rgba(128, 128, 128, 0.03);
}

.choice-module-card-dragging {
  opacity: 0.4;
  box-shadow: var(--choice-shadow-lg);
  transform: scale(1.02);
}

.choice-module-card-drag-over {
  border-top: 2px solid var(--choice-primary);
  box-shadow: inset 0 2px 8px var(--choice-primary-glow);
}

.choice-module-drag {
  cursor: grab;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-base);
  padding: 0 2px;
  flex-shrink: 0;
}

.choice-module-drag:active {
  cursor: grabbing;
}

.choice-module-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.choice-module-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-module-name {
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text-secondary);
  cursor: text;
  white-space: nowrap;
}

.choice-module-role {
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  font-weight: 500;
  text-transform: uppercase;
  flex-shrink: 0;
}

.choice-role-system {
  background: var(--choice-primary-light);
  color: var(--choice-color-info);
}

.choice-role-user {
  background: rgba(100, 180, 100, 0.2);
  color: var(--choice-color-success);
}

.choice-role-assistant {
  background: rgba(180, 140, 80, 0.2);
  color: var(--choice-color-warning);
}

.choice-module-lock {
  font-size: var(--choice-text-xs);
  flex-shrink: 0;
}

.choice-module-preview {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.choice-module-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.choice-module-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--choice-text-sm);
}

.choice-module-toggle {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.choice-rename-input {
  font-size: var(--choice-text-sm);
  width: 120px;
  padding: 2px var(--choice-space-1);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-rename-input:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-module-edit {
  margin-top: var(--choice-space-1);
  padding: var(--choice-space-2);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-module-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-preview-box {
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-2);
  background: var(--choice-bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-preview-empty {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  text-align: center;
  padding: var(--choice-space-3) 0;
}

.choice-preview-msg {
  border-radius: var(--choice-space-1);
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-xs);
}

.choice-preview-system {
  background: rgba(var(--choice-primary-rgb), 0.12);
  border-left: 3px solid var(--choice-primary);
}

.choice-preview-user {
  background: rgba(100, 180, 100, 0.12);
  border-left: 3px solid #5aaf5a;
}

.choice-preview-assistant {
  background: rgba(180, 140, 80, 0.12);
  border-left: 3px solid var(--choice-text-hint);
}

.choice-preview-role {
  font-weight: bold;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  margin-bottom: 2px;
}

.choice-preview-content {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--choice-text-secondary);
  margin: 0;
  font-family: inherit;
  line-height: 1.4;
}

.choice-beginner-section {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
}

.choice-beginner-body {
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-field-label {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-field-label label {
  font-weight: 600;
}

.choice-field-module {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  background: var(--choice-bg-card);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
}

.choice-field-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  line-height: 1.4;
}

.choice-restore-btn {
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-2);
  margin-left: auto;
}

.choice-filter-section {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
}

.choice-filter-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  cursor: pointer;
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  user-select: none;
}

.choice-filter-header:hover {
  background: rgba(128, 128, 128, 0.05);
}

.choice-filter-header i {
  font-size: var(--choice-text-xs);
  width: 12px;
  text-align: center;
}

.choice-filter-body {
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
}

.choice-filter-desc {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  margin: 0;
  line-height: 1.4;
}

.choice-filter-row {
  display: flex;
  gap: var(--choice-space-1);
  align-items: center;
}

.choice-filter-row input {
  flex: 1;
  min-width: 0;
  font-size: var(--choice-text-sm);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-filter-row input:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-filter-type {
  flex-shrink: 0;
  width: 96px;
  font-size: var(--choice-text-sm);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-filter-type:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-filter-del {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
}

.choice-filter-group {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
}

.choice-filter-group-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  background: var(--choice-bg-card);
  cursor: pointer;
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text-secondary);
  user-select: none;
}

.choice-filter-group-header:hover {
  background: rgba(128, 128, 128, 0.05);
}

.choice-filter-group-caret {
  font-size: var(--choice-text-xs);
  width: 12px;
  text-align: center;
  cursor: pointer;
  color: var(--choice-text-muted);
  flex-shrink: 0;
}

.choice-filter-group-name {
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text-secondary);
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.choice-filter-group-header .choice-filter-del {
  flex-shrink: 0;
}

.choice-filter-group-header .choice-module-toggle {
  flex-shrink: 0;
}

.choice-filter-group-body {
  padding: var(--choice-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  border-top: 1px solid var(--choice-border);
}

.choice-enrich-badge-sm {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: rgba(var(--choice-primary-rgb), 0.18);
  color: var(--choice-color-info);
  font-weight: 500;
  flex-shrink: 0;
}

.choice-option-badge-sm {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: rgba(217, 144, 74, 0.18);
  color: #e0a06a;
  font-weight: 500;
  flex-shrink: 0;
}

.choice-mode-switch {
  display: flex;
  gap: 0;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
  align-self: flex-start;
}

.choice-mode-btn {
  padding: var(--choice-space-1) var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-mode-btn:not(:last-child) {
  border-right: 1px solid var(--choice-border);
}

.choice-mode-btn:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text-secondary);
}

.choice-mode-btn--active {
  background: var(--choice-primary);
  color: var(--choice-text-on-primary);
}

.choice-mode-btn--active:hover {
  background: var(--choice-primary-hover);
  color: var(--choice-text-on-primary);
}

.choice-export-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.choice-export-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}

/* 箭头是按钮内部装饰而非独立按键，随菜单开合旋转 */
.choice-export-caret {
  font-size: var(--choice-text-xs);
  transition: transform var(--choice-transition);
}

.choice-export-caret--open {
  transform: rotate(180deg);
}

.choice-export-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: var(--choice-z-dropdown);
  min-width: 140px;
  margin-top: 2px;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  box-shadow: var(--choice-shadow-md);
  overflow: hidden;
}

.choice-export-dropdown button {
  display: block;
  width: 100%;
  padding: var(--choice-space-2) var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background var(--choice-transition);
}

.choice-export-dropdown button:hover {
  background: var(--choice-bg-hover);
}
</style>
