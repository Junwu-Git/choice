<template>
  <div class="choice-prompt-editor">
    <div class="choice-page-toolbar">
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
    </div>

    <div class="choice-config-bar">
      <div class="choice-config-row">
        <label class="choice-config-label">{{ t`提示词配置` }}</label>
        <select v-model="selectedPromptConfigId" class="text_pole choice-config-select">
          <option v-for="cfg in promptConfigs" :key="cfg.id" :value="cfg.id">{{ cfg.name }}</option>
        </select>
        <button
          class="choice-btn-sm"
          :disabled="!selectedPromptConfig"
          :title="t`重命名`"
          @click="startRenamePromptConfig"
        >
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <div class="choice-config-actions">
          <button
            class="choice-btn-sm"
            :disabled="selectedPromptConfig?.is_default"
            :title="t`设为默认`"
            @click="setPromptDefault"
          >
            <i class="fa-solid fa-star"></i>
          </button>
          <button
            class="choice-btn-sm"
            :class="{ active: selectedPromptConfigId === chatStore.settings.prompt_config_id }"
            :title="
              selectedPromptConfigId === chatStore.settings.prompt_config_id
                ? t`当前聊天已绑定（点击取消）`
                : t`绑定到当前聊天`
            "
            @click="bindPromptChat"
          >
            <i class="fa-solid fa-comment"></i>
          </button>
          <button
            class="choice-btn-sm"
            :class="{ active: selectedPromptConfigId === characterStore.settings.prompt_config_id }"
            :title="
              selectedPromptConfigId === characterStore.settings.prompt_config_id
                ? t`当前角色已绑定（点击取消）`
                : t`绑定到当前角色`
            "
            @click="bindPromptCharacter"
          >
            <i class="fa-solid fa-user"></i>
          </button>
          <button
            class="choice-btn-sm choice-btn-del"
            :disabled="selectedPromptConfig?.is_default"
            :title="t`删除`"
            @click="removePromptConfig"
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
          <button class="choice-btn-sm choice-btn-new" :title="t`新建`" @click="showCreatePromptConfig = true">
            <i class="fa-solid fa-plus"></i> {{ t`新建` }}
          </button>
        </div>
      </div>
      <div class="choice-config-status">
        <span class="choice-config-status-label">{{ t`当前生效` }}:</span>
        <span class="choice-config-status-name">{{ effectiveConfigName }}</span>
        <span v-if="chatStore.settings.prompt_config_id" class="choice-bound-badge">{{ t`聊天` }}</span>
        <span v-if="characterStore.settings.prompt_config_id" class="choice-bound-badge choice-bound-char">{{
          t`角色`
        }}</span>
      </div>
    </div>

    <div class="choice-module-toolbar">
      <div class="choice-module-toolbar-left">
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
      </div>
      <div class="choice-module-toolbar-right">
        <div class="choice-export-wrap">
          <button
            class="menu_button choice-export-btn"
            :title="t`添加新的提示词模块`"
            @click.stop="showAddMenu = !showAddMenu"
          >
            <span>{{ t`新增模块` }}</span>
            <i
              class="fa-solid fa-chevron-down choice-export-caret"
              :class="{ 'choice-export-caret--open': showAddMenu }"
            ></i>
          </button>
          <div v-if="showAddMenu" class="choice-export-dropdown">
            <button
              @click="
                addModule(false, false);
                showAddMenu = false;
              "
            >
              {{ t`通用模块` }}
            </button>
            <button
              @click="
                addModule(false, true);
                showAddMenu = false;
              "
            >
              {{ t`选项模块` }}
            </button>
            <button
              v-if="globalStore.settings.ui.enrich_enabled"
              @click="
                addModule(true, false);
                showAddMenu = false;
              "
            >
              {{ t`润色模块` }}
            </button>
          </div>
        </div>
        <div class="choice-export-wrap">
          <button
            class="menu_button choice-export-btn"
            :title="t`选择要导出的模块范围`"
            @click.stop="showExportMenu = !showExportMenu"
          >
            <span>{{ t`导出` }}</span>
            <i
              class="fa-solid fa-chevron-down choice-export-caret"
              :class="{ 'choice-export-caret--open': showExportMenu }"
            ></i>
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
        <button
          class="menu_button"
          :title="t`将所有提示词模块完全恢复为默认值（包括顺序、启用状态、内容）`"
          @click="resetPromptToDefaults"
        >
          {{ t`恢复默认` }}
        </button>
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
      :open="restoreTarget !== null"
      :title="t`恢复默认`"
      :message="t`确定要将该模块恢复为默认内容吗？当前修改将丢失。`"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onRestoreConfirm"
      @cancel="restoreTarget = null"
    />

    <CreateConfigDialog
      :open="showCreatePromptConfig"
      @close="showCreatePromptConfig = false"
      @create="onCreatePromptConfig"
    />
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePromptConfigSelectorStore } from '@/store/prompt-config-selector';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import CreateConfigDialog from '@/components/CreateConfigDialog.vue';
import type { PromptModule } from '@/type/settings';
import { BAIBAI_MODULE_IDS, PromptModule as PromptModuleSchema } from '@/type/settings';
import { z } from 'zod';

const globalStore = useGlobalSettingsStore();
const characterStore = useCharacterSettingsStore();
const chatStore = useChatSettingsStore();
const promptConfigSelector = usePromptConfigSelectorStore();
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
]);
const DEPRECATED_MODULE_IDS = new Set(['baibai_state']);

const allModules = computed(() => {
  let modules = globalStore.allModules.filter(m => !DEPRECATED_MODULE_IDS.has(m.id));
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
const showAddMenu = ref(false);

const baibaiFilteredModules = computed(() => {
  let modules = globalStore.allModules.filter(m => !DEPRECATED_MODULE_IDS.has(m.id));
  if (!rules.baibai_enabled) {
    modules = modules.filter(m => !BAIBAI_MODULE_IDS.has(m.id));
  }
  return modules;
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

const editingId = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameText = ref('');
const deleteTarget = ref<string | null>(null);
const restoreTarget = ref<string | null>(null);

// 提示词配置栏
const promptConfigs = computed(() => globalStore.settings.prompt_configs);
const effectiveConfig = computed(() => promptConfigSelector.effectiveConfig);
const effectiveConfigName = computed(() => effectiveConfig.value?.name ?? '—');
const selectedPromptConfigId = ref<string | null>(null);
const showCreatePromptConfig = ref(false);

watch(
  [promptConfigs, effectiveConfig],
  () => {
    if (promptConfigs.value.length === 0) {
      selectedPromptConfigId.value = null;
      return;
    }
    if (!selectedPromptConfigId.value || !promptConfigs.value.find(c => c.id === selectedPromptConfigId.value)) {
      selectedPromptConfigId.value = effectiveConfig.value?.id ?? promptConfigs.value[0].id;
    }
  },
  { immediate: true },
);

const selectedPromptConfig = computed(
  () => promptConfigs.value.find(c => c.id === selectedPromptConfigId.value) ?? null,
);

watch(selectedPromptConfigId, newId => {
  if (newId) {
    try {
      globalStore.switchPromptConfig(newId);
    } catch (e) {
      console.warn('[Choice] switchPromptConfig failed', e);
    }
  }
});

function startRenamePromptConfig() {
  const cfg = selectedPromptConfig.value;
  if (!cfg) return;
  const name = prompt(t`请输入新名称`, cfg.name);
  if (name && name.trim() && name.trim() !== cfg.name) {
    globalStore.renamePromptConfig(cfg.id, name.trim());
  }
}

function setPromptDefault() {
  if (!selectedPromptConfigId.value) return;
  globalStore.setDefaultPromptConfig(selectedPromptConfigId.value);
}

function bindPromptChat() {
  const id = selectedPromptConfigId.value;
  chatStore.settings.prompt_config_id = chatStore.settings.prompt_config_id === id ? null : id;
}

function bindPromptCharacter() {
  const id = selectedPromptConfigId.value;
  characterStore.settings.prompt_config_id = characterStore.settings.prompt_config_id === id ? null : id;
}

function removePromptConfig() {
  const cfg = selectedPromptConfig.value;
  if (!cfg || cfg.is_default) return;
  if (!confirm(t`确定要删除配置「${cfg.name}」吗？此操作不可撤销。`)) return;
  globalStore.deletePromptConfig(cfg.id);
  if (promptConfigs.value.length > 0) {
    selectedPromptConfigId.value = effectiveConfig.value?.id ?? promptConfigs.value[0].id;
  }
}

function onCreatePromptConfig(payload: { name: string; isDefault: boolean; bindChat: boolean; bindChar: boolean }) {
  const cfg = globalStore.createPromptConfig(payload.name, payload.isDefault);
  selectedPromptConfigId.value = cfg.id;
  if (payload.bindChat) chatStore.settings.prompt_config_id = cfg.id;
  if (payload.bindChar) characterStore.settings.prompt_config_id = cfg.id;
  showCreatePromptConfig.value = false;
}

const editingModule = computed(() => {
  if (!editingId.value) return null;
  return rules.modules.find(m => m.id === editingId.value) ?? null;
});

const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const addModule = (enrichOnly = false, optionOnly = false) => {
  globalStore.addModule(undefined, enrichOnly, optionOnly);
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

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.choice-export-wrap')) {
    showExportMenu.value = false;
    showAddMenu.value = false;
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

.choice-page-toolbar {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-module-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-module-toolbar-left,
.choice-module-toolbar-right {
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
