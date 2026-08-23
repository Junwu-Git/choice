<template>
  <div class="choice-prompt-editor">
    <div class="choice-prompt-toolbar">
      <div class="choice-prompt-toolbar-left">
        <button class="menu_button" @click="addModule">{{ t`新增模块` }}</button>
        <button class="menu_button" @click="resetOrder">{{ t`重置顺序` }}</button>
      </div>
      <div class="choice-prompt-toolbar-right">
        <label class="choice-context-rounds">
          <span>{{ t`上下文轮数` }}</span>
          <input v-model.number="rules.context_rounds" class="text_pole" type="number" min="0" style="width: 60px" />
        </label>
        <button class="menu_button" @click="togglePreview">
          <i class="fa-solid" :class="showPreview ? 'fa-eye-slash' : 'fa-eye'"></i>
          {{ showPreview ? t`隐藏预览` : t`预览` }}
        </button>
      </div>
    </div>

    <div class="choice-filter-section">
      <div class="choice-filter-header" @click="showFilter = !showFilter">
        <i class="fa-solid" :class="showFilter ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        <span>{{ t`聊天记录过滤` }}</span>
      </div>
      <div v-if="showFilter" class="choice-filter-body">
        <p class="choice-filter-desc">{{ t`过滤聊天记录中标签包裹或匹配正则的内容（如思维链、小剧场、防截断等）` }}</p>
        <div
          v-for="group in rules.chat_filter_groups"
          :key="group.id"
          class="choice-filter-group"
        >
          <div class="choice-filter-group-header">
            <i
              class="fa-solid choice-filter-group-caret"
              :class="groupExpanded[group.id] ? 'fa-chevron-down' : 'fa-chevron-right'"
              @click="toggleGroup(group.id)"
            ></i>
            <span
              v-if="groupRenameId !== group.id"
              class="choice-filter-group-name"
              @dblclick="startGroupRename(group)"
            >{{ group.name }}</span>
            <input
              v-else
              ref="groupRenameInput"
              v-model="groupRenameText"
              class="text_pole"
              style="width: 100px; font-size: 12px"
              @blur="finishGroupRename(group)"
              @keydown.enter="finishGroupRename(group)"
              @keydown.escape="cancelGroupRename"
            />
            <label class="choice-module-toggle" :title="group.enabled ? t`启用` : t`禁用`">
              <input type="checkbox" :checked="group.enabled" @change="group.enabled = !group.enabled" />
            </label>
            <button class="menu_button choice-filter-del" :title="t`新增规则`" @click="addFilterRule(group.id)">+</button>
            <button class="menu_button choice-filter-del" :title="t`删除分组`" @click="deleteGroupTarget = group.id">
              <i class="fa-solid fa-trash" style="color: #e06666"></i>
            </button>
          </div>
          <div v-if="groupExpanded[group.id]" class="choice-filter-group-body">
            <div
              v-for="(rule, idx) in group.rules"
              :key="idx"
              class="choice-filter-row"
            >
              <select v-model="rule.type" class="text_pole choice-filter-type">
                <option value="tag">{{ t`标签匹配` }}</option>
                <option value="regex">{{ t`正则表达式` }}</option>
              </select>
              <template v-if="rule.type === 'tag'">
                <input
                  v-model="rule.start"
                  class="text_pole"
                  :placeholder="t`标签头`"
                />
                <input
                  v-model="rule.end"
                  class="text_pole"
                  :placeholder="t`标签尾`"
                />
              </template>
              <input
                v-else
                v-model="rule.pattern"
                class="text_pole"
                :placeholder="t`正则表达式`"
              />
              <button class="menu_button choice-filter-del" @click="removeFilterRule(group.id, idx)">✕</button>
            </div>
          </div>
        </div>
        <button class="menu_button" @click="addFilterGroup">{{ t`新增分组` }}</button>
      </div>
    </div>

    <div
      class="choice-module-list"
      @dragover.prevent="onListDragOver"
      @drop.prevent="onListDrop"
    >
      <template
        v-for="(mod, idx) in allModules"
        :key="mod.id"
      >
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
            <span
              v-if="renamingId !== mod.id"
              class="choice-module-name"
              @dblclick="startRename(mod)"
            >{{ mod.name }}</span>
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
          <button v-if="!READONLY_MODULE_IDS.has(mod.id)" class="menu_button choice-module-btn" :title="t`复制`" @click="copyModule(mod.id)">📋</button>
          <button v-if="!mod.marker" class="menu_button choice-module-btn" :title="t`编辑`" @click="toggleEdit(mod.id)">
            {{ editingId === mod.id ? '✕' : '🖉' }}
          </button>
          <button v-if="!mod.system" class="menu_button choice-module-btn" :title="t`删除`" @click="deleteTarget = mod.id">
            <i class="fa-solid fa-trash" style="color: #e06666"></i>
          </button>
        </div>
      </div>

      <div
        v-if="editingId === mod.id"
        class="choice-module-edit"
      >
        <div class="choice-module-edit-head">
          <span>{{ t`编辑模块` }}: {{ editingModule?.name }}</span>
          <select v-if="editingModule" v-model="editingModule.role" class="text_pole" style="width: auto">
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </div>
        <textarea
          v-if="editingModule"
          v-model="editingModule.content"
          class="text_pole"
          rows="8"
        ></textarea>
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
import { chat, characters, this_chid } from '@sillytavern/script';
import { uuidv4 } from '@sillytavern/scripts/utils';

const globalStore = useGlobalSettingsStore();
const rules = globalStore.settings.prompt_rules;

/** 只读模块：仅允许移动和开关，不可编辑/删除/复制 */
const READONLY_MODULE_IDS = new Set(['world_info_before', 'persona_description', 'world_info_after', 'chat_history']);

const allModules = computed(() => globalStore.allModules);

const showPreview = ref(false);
const showFilter = ref(true);
const editingId = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameText = ref('');
const deleteTarget = ref<string | null>(null);
const deleteGroupTarget = ref<string | null>(null);
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

const resetOrder = () => {
  globalStore.resetModuleOrder();
};

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
  const sorted = [...rules.modules].filter(m => m.enabled).sort((a, b) => a.order - b.order);

  for (const mod of sorted) {
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
          msgs.push({ role: m.is_user ? 'user' : 'assistant', content: c.slice(0, 200) + (c.length > 200 ? '...' : '') });
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
</script>

<style scoped>
.choice-prompt-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-prompt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.choice-prompt-toolbar-left,
.choice-prompt-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.choice-context-rounds {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--choice-text-secondary);
}

.choice-module-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 40px;
}

.choice-module-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  cursor: default;
  transition: border-color var(--choice-transition), box-shadow var(--choice-transition), transform var(--choice-transition);
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
  font-size: 14px;
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
  gap: 6px;
}

.choice-module-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--choice-text-secondary);
  cursor: text;
  white-space: nowrap;
}

.choice-module-role {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--choice-radius-full);
  font-weight: 500;
  text-transform: uppercase;
  flex-shrink: 0;
}

.choice-role-system {
  background: rgba(74, 144, 217, 0.2);
  color: #6aabe0;
}

.choice-role-user {
  background: rgba(100, 180, 100, 0.2);
  color: #6ac06a;
}

.choice-role-assistant {
  background: rgba(180, 140, 80, 0.2);
  color: #c8a460;
}

.choice-module-lock {
  font-size: 11px;
  flex-shrink: 0;
}

.choice-module-preview {
  font-size: 11px;
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
  font-size: 12px;
}

.choice-module-toggle {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.choice-rename-input {
  font-size: 12px;
  width: 120px;
  padding: 2px 4px;
}

.choice-module-edit {
  margin-top: 4px;
  padding: 8px;
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choice-module-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--choice-text-secondary);
}

.choice-preview-box {
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: 8px;
  background: var(--choice-bg-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choice-preview-empty {
  color: var(--choice-text-muted);
  font-size: 11px;
  text-align: center;
  padding: 12px 0;
}

.choice-preview-msg {
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
}

.choice-preview-system {
  background: rgba(74, 144, 217, 0.12);
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
  font-size: 10px;
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

.choice-filter-section {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
}

.choice-filter-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  user-select: none;
}

.choice-filter-header:hover {
  background: rgba(128, 128, 128, 0.05);
}

.choice-filter-header i {
  font-size: 10px;
  width: 12px;
  text-align: center;
}

.choice-filter-body {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--choice-border);
}

.choice-filter-desc {
  font-size: 11px;
  color: var(--choice-text-muted);
  margin: 0;
  line-height: 1.4;
}

.choice-filter-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.choice-filter-row input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
}

.choice-filter-type {
  flex-shrink: 0;
  width: 96px;
  font-size: 12px;
}

.choice-filter-del {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
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
  gap: 6px;
  padding: 4px 8px;
  background: var(--choice-bg-card);
}

.choice-filter-group-caret {
  font-size: 10px;
  width: 12px;
  text-align: center;
  cursor: pointer;
  color: var(--choice-text-muted);
  flex-shrink: 0;
}

.choice-filter-group-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--choice-text-secondary);
  cursor: text;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.choice-filter-group-body {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--choice-border);
}
</style>