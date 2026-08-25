<template>
  <div class="choice-pool-editor">
    <!-- 配置工具栏 -->
    <div class="choice-config-bar">
      <div class="choice-config-row">
        <label class="choice-config-label">{{ t`配置` }}</label>
        <select v-model="selectedConfigId" class="text_pole choice-config-select">
          <option v-for="cfg in configs" :key="cfg.id" :value="cfg.id">{{ cfg.name }}</option>
        </select>
        <div class="choice-config-actions">
          <button class="choice-btn-sm" :title="t`设为默认`" :disabled="selectedConfig?.is_default" @click="setDefault">
            <i class="fa-solid fa-star"></i>
          </button>
          <button
            class="choice-btn-sm"
            :class="{ active: selectedConfigId === chatStore.settings.config_id }"
            :title="
              selectedConfigId === chatStore.settings.config_id ? t`当前聊天已绑定（点击取消）` : t`绑定到当前聊天`
            "
            @click="bindChat"
          >
            <i class="fa-solid fa-comment"></i>
          </button>
          <button
            class="choice-btn-sm"
            :class="{ active: selectedConfigId === characterStore.settings.config_id }"
            :title="
              selectedConfigId === characterStore.settings.config_id ? t`当前角色已绑定（点击取消）` : t`绑定到当前角色`
            "
            @click="bindCharacter"
          >
            <i class="fa-solid fa-user"></i>
          </button>
          <button
            class="choice-btn-sm choice-btn-del"
            :title="t`删除`"
            :disabled="selectedConfig?.is_default"
            @click="removeConfig"
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
          <button class="choice-btn-sm choice-btn-new" :title="t`新建`" @click="showCreateDialog = true">
            <i class="fa-solid fa-plus"></i> {{ t`新建` }}
          </button>
        </div>
      </div>
      <div class="choice-config-status">
        <span class="choice-config-status-label">{{ t`当前生效` }}:</span>
        <span class="choice-config-status-name">{{ effectiveName }}</span>
        <span v-if="chatStore.settings.config_id" class="choice-bound-badge">{{ t`聊天` }}</span>
        <span v-if="characterStore.settings.config_id" class="choice-bound-badge choice-bound-char">{{ t`角色` }}</span>
        <span v-if="!effectiveConfig" class="choice-bound-badge choice-bound-fallback">{{ t`全部条目` }}</span>
      </div>
    </div>

    <hr class="sysHR" />

    <!-- 配置编辑区域（始终可编辑） -->
    <div v-if="selectedConfig && configs.length > 0" class="choice-inline-edit">
      <!-- 抽取参数（置顶） -->
      <div class="choice-inline-field">
        <label class="choice-inline-label">{{ t`抽取参数` }}</label>
        <div class="choice-inline-gen">
          <label class="choice-inline-gen-item">
            <span>{{ t`数量` }}</span>
            <input
              v-model="selectedConfig.generation.count_mode"
              class="text_pole choice-small-input"
              :placeholder="t`如 4 或 3-6`"
            />
          </label>
          <label class="choice-check" :title="t`按条目分类分组轮流抽取，避免同组扎堆`">
            <input v-model="selectedConfig.generation.categories_enabled" type="checkbox" />
            {{ t`分组抽取` }}
          </label>
          <label class="choice-check" :title="t`结果随机打乱，避免固定条目总在开头`">
            <input v-model="selectedConfig.generation.shuffle_final" type="checkbox" />
            {{ t`打乱结果` }}
          </label>
          <label class="choice-inline-gen-item">
            <span :title="t`固定条目超过数量上限时：全发=全部保留，截断=只取前N个`">{{ t`固定溢出` }}</span>
            <select v-model="selectedConfig.generation.pinned_overflow" class="text_pole">
              <option value="send_all">{{ t`全发` }}</option>
              <option value="trim">{{ t`截断` }}</option>
            </select>
          </label>
        </div>
      </div>

      <!-- 已选条目列表 -->
      <div class="choice-inline-field">
        <div class="choice-inline-field-head">
          <label class="choice-inline-label">{{ t`已选条目` }} ({{ selectedCount }})</label>
          <button
            class="choice-btn-sm choice-btn-new"
            :title="t`从条目库勾选条目添加到当前配置`"
            @click="showSelectDialog = true"
          >
            <i class="fa-solid fa-plus"></i> {{ t`添加条目` }}
          </button>
        </div>
        <div v-if="selectedEntries.length > 0" ref="entriesContainer" class="choice-inline-entries">
          <div v-for="cfgEntry in selectedEntries" :key="cfgEntry.entry_id" class="choice-inline-entry">
            <div class="choice-inline-entry-row">
              <span class="choice-inline-entry-text">
                <span
                  class="choice-inline-cat-badge"
                  :class="{ 'choice-inline-cat-badge--muted': !getEntryCategory(cfgEntry.entry_id) }"
                  >{{ getEntryCategory(cfgEntry.entry_id) || t`未分组` }}</span
                >
                {{ getEntryText(cfgEntry.entry_id) }}
              </span>
              <div class="choice-inline-entry-fields">
                <label class="choice-check">
                  <input v-model="cfgEntry.pinned" type="checkbox" />
                  {{ t`固定` }}
                </label>
                <label class="choice-inline-field-item">
                  <span class="choice-inline-field-label">{{ t`权重` }}</span>
                  <input v-model.number="cfgEntry.weight" class="text_pole choice-small-input" type="number" min="0" />
                </label>
                <label class="choice-inline-field-item">
                  <span class="choice-inline-field-label">{{ t`条件` }}</span>
                  <input
                    v-model="cfgEntry.condition"
                    class="text_pole choice-cond-input"
                    :placeholder="t`如:战斗场景、关系亲密时`"
                  />
                </label>
                <button
                  class="choice-icon-btn choice-delete-btn"
                  :title="t`移除`"
                  @click="removeConfigEntry(cfgEntry.entry_id)"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="choice-empty-hint">
          <span>{{ t`未选择条目，请点击"添加条目"选择` }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="configs.length === 0" class="choice-empty-hint">
      <span>{{ t`暂无配置，请点击新建创建配置` }}</span>
    </div>

    <hr class="sysHR" />

    <!-- 条目库入口 -->
    <button class="choice-entrypool-btn" :title="t`打开条目库管理弹窗`" @click="showEntryPool = true">
      <i class="fa-solid fa-database"></i>
      {{ t`条目库` }} ({{ masterPool.length }})
    </button>

    <EntryPoolDialog :open="showEntryPool" @close="showEntryPool = false" />

    <CreateConfigDialog :open="showCreateDialog" @close="showCreateDialog = false" @create="onCreateConfig" />

    <SelectEntriesDialog
      :open="showSelectDialog"
      :title="t`选择条目`"
      :selected-ids="selectedEntryIds"
      @close="showSelectDialog = false"
      @confirm="handleSelectEntries"
    />
  </div>
</template>

<script setup lang="ts">
import EntryPoolDialog from '@/components/EntryPoolDialog.vue';
import CreateConfigDialog from '@/components/CreateConfigDialog.vue';
import SelectEntriesDialog from '@/components/SelectEntriesDialog.vue';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { PoolConfig, PoolConfigEntry, PoolEntry } from '@/type/settings';
import Sortable from 'sortablejs';

const globalStore = useGlobalSettingsStore();
const characterStore = useCharacterSettingsStore();
const chatStore = useChatSettingsStore();
const poolSelector = usePoolSelectorStore();

const masterPool = computed(() => globalStore.settings.master_pool);
const configs = computed(() => globalStore.settings.configs);
const effectiveConfig = computed(() => poolSelector.effectiveConfig);

const selectedConfigId = ref<string | null>(null);
const showEntryPool = ref(false);
const showCreateDialog = ref(false);
const showSelectDialog = ref(false);

watch(
  [configs, effectiveConfig],
  () => {
    if (configs.value.length === 0) {
      selectedConfigId.value = null;
      return;
    }
    if (!selectedConfigId.value || !configs.value.find(c => c.id === selectedConfigId.value)) {
      selectedConfigId.value = effectiveConfig.value?.id ?? configs.value[0].id;
    }
  },
  { immediate: true },
);

const selectedConfig = computed(() => configs.value.find(c => c.id === selectedConfigId.value) ?? null);

const effectiveName = computed(() => {
  if (!effectiveConfig.value) return t`全部条目`;
  if (chatStore.settings.config_id) return effectiveConfig.value.name;
  if (characterStore.settings.config_id) return effectiveConfig.value.name;
  return effectiveConfig.value.name;
});

const onCreateConfig = (payload: { name: string; isDefault: boolean; bindChat: boolean; bindChar: boolean }) => {
  const id = uuidv4();
  const newConfig: PoolConfig = {
    id,
    name: payload.name,
    entries: [],
    is_default: payload.isDefault || configs.value.length === 0,
    generation: {
      count_mode: '4',
      categories_enabled: true,
      shuffle_final: true,
      pinned_overflow: 'send_all',
      cross_layer_fallback: false,
    },
  };
  if (payload.isDefault) {
    for (const cfg of configs.value) {
      cfg.is_default = false;
    }
  }
  configs.value.push(newConfig);
  selectedConfigId.value = id;
  if (payload.bindChat) chatStore.settings.config_id = id;
  if (payload.bindChar) characterStore.settings.config_id = id;
  showCreateDialog.value = false;
};

const setDefault = () => {
  if (!selectedConfig.value) return;
  for (const cfg of configs.value) {
    cfg.is_default = cfg.id === selectedConfigId.value;
  }
};

const bindChat = () => {
  const id = selectedConfigId.value;
  chatStore.settings.config_id = chatStore.settings.config_id === id ? null : id;
};

const bindCharacter = () => {
  const id = selectedConfigId.value;
  characterStore.settings.config_id = characterStore.settings.config_id === id ? null : id;
};

const removeConfig = () => {
  const cfg = selectedConfig.value;
  if (!cfg || cfg.is_default) return;
  const idx = configs.value.findIndex(c => c.id === cfg.id);
  if (idx === -1) return;
  configs.value.splice(idx, 1);
  if (chatStore.settings.config_id === cfg.id) chatStore.settings.config_id = null;
  if (characterStore.settings.config_id === cfg.id) characterStore.settings.config_id = null;
  if (configs.value.length > 0) {
    selectedConfigId.value = effectiveConfig.value?.id ?? configs.value[0].id;
  }
};

const selectedCount = computed(() => selectedConfig.value?.entries.length ?? 0);

const selectedEntries = computed(() => selectedConfig.value?.entries ?? []);

const selectedEntryIds = computed(() => {
  if (!selectedConfig.value) return new Set<string>();
  return new Set(selectedConfig.value.entries.map(e => e.entry_id));
});

const getEntryCategory = (entryId: string): string => {
  const entry = masterPool.value.find(e => e.id === entryId);
  return entry?.category?.trim() || '';
};

const getEntryText = (entryId: string): string => {
  const entry = masterPool.value.find(e => e.id === entryId);
  if (!entry) return t`<空条目>`;
  const text = entry.text.trim();
  if (!text) return t`<空条目>`;
  return text.replace(/"/g, '').slice(0, 50);
};

const removeConfigEntry = (entryId: string) => {
  if (!selectedConfig.value) return;
  const idx = selectedConfig.value.entries.findIndex(e => e.entry_id === entryId);
  if (idx !== -1) selectedConfig.value.entries.splice(idx, 1);
};

const handleSelectEntries = (selectedIds: Set<string>) => {
  if (!selectedConfig.value) return;
  const currentIds = new Set(selectedConfig.value.entries.map(e => e.entry_id));
  for (let i = selectedConfig.value.entries.length - 1; i >= 0; i--) {
    if (!selectedIds.has(selectedConfig.value.entries[i].entry_id)) {
      selectedConfig.value.entries.splice(i, 1);
    }
  }
  for (const id of selectedIds) {
    if (!currentIds.has(id)) {
      const src = masterPool.value.find(e => e.id === id);
      selectedConfig.value.entries.push({
        entry_id: id,
        pinned: src?.pinned ?? false,
        weight: src?.weight ?? 1,
        condition: src?.condition ?? '',
      });
    }
  }
  showSelectDialog.value = false;
};

const entriesContainer = ref<HTMLElement | null>(null);
let sortable: Sortable | null = null;

onMounted(() => {
  watch(
    entriesContainer,
    el => {
      if (sortable) sortable.destroy();
      if (!el || !selectedConfig.value) return;
      sortable = Sortable.create(el, {
        animation: 150,
        onEnd: evt => {
          if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
          const entries = selectedConfig.value?.entries;
          if (!entries) return;
          const [moved] = entries.splice(evt.oldIndex, 1);
          entries.splice(evt.newIndex, 0, moved);
        },
      });
    },
    { immediate: true },
  );
});

onUnmounted(() => {
  if (sortable) sortable.destroy();
});
</script>

<style scoped>
.choice-pool-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-config-bar {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-config-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-config-label {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.choice-config-select {
  flex: 1;
  min-width: 0;
}

.choice-config-actions {
  display: inline-flex;
  gap: var(--choice-space-1);
  align-items: center;
  flex-shrink: 0;
}

.choice-btn-sm {
  font-size: var(--choice-text-xs);
  padding: var(--choice-space-1) var(--choice-space-2);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-btn-sm:hover:not(:disabled) {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-btn-sm:disabled {
  opacity: 0.35;
  cursor: default;
}

.choice-btn-sm.active {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
  color: #fff;
}

.choice-btn-del {
  color: #c86a6a;
}

.choice-btn-del:hover:not(:disabled) {
  color: #e07070;
}

.choice-btn-new {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
  color: #fff;
}

.choice-btn-new:hover {
  background: var(--choice-primary-hover);
  border-color: var(--choice-primary-hover);
}

.choice-config-status {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-xs);
}

.choice-config-status-label {
  color: var(--choice-text-muted);
}

.choice-config-status-name {
  color: var(--choice-text);
  font-weight: bold;
}

.choice-bound-badge {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: rgba(90, 138, 90, 0.15);
  border: 1px solid rgba(90, 138, 90, 0.2);
  color: #6ac06a;
  flex-shrink: 0;
}

.choice-bound-char {
  background: rgba(138, 106, 74, 0.15);
  border-color: rgba(138, 106, 74, 0.2);
  color: #c8a460;
}

.choice-bound-fallback {
  background: rgba(180, 180, 180, 0.15);
  border-color: rgba(180, 180, 180, 0.2);
  color: var(--choice-text-muted);
}

.choice-entrypool-btn {
  width: 100%;
  padding: var(--choice-space-3);
  border: 1px dashed var(--choice-border-strong);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--choice-space-2);
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
}

.choice-entrypool-btn:hover {
  background: var(--choice-bg-hover);
  border-color: var(--choice-primary);
  color: var(--choice-text);
}

/* 内联编辑区域 */
.choice-inline-edit {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
}

.choice-inline-field {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-inline-label {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  font-weight: bold;
}

.choice-inline-gen {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-inline-gen-item {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-inline-gen-item .text_pole {
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-1);
}

.choice-inline-gen-item select.text_pole {
  width: auto;
}

.choice-inline-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
}

.choice-inline-field-head .choice-inline-label {
  margin-bottom: 0;
}

.choice-inline-entries {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-2);
}

.choice-inline-entry {
  border-radius: var(--choice-radius-sm);
  border: 1px solid var(--choice-border);
  background: var(--choice-bg-card);
  overflow: hidden;
}

.choice-inline-entry-row {
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 0;
}

.choice-inline-entry-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  padding: var(--choice-space-2) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-inline-cat-badge {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: rgba(74, 144, 217, 0.12);
  border: 1px solid rgba(74, 144, 217, 0.2);
  color: #6a9fd8;
  flex-shrink: 0;
  white-space: nowrap;
}

.choice-inline-cat-badge--muted {
  background: rgba(180, 180, 180, 0.1);
  border-color: rgba(180, 180, 180, 0.15);
  color: var(--choice-text-muted);
}

.choice-inline-entry-fields {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-2) var(--choice-space-2) 0;
  flex-wrap: nowrap;
  border-left: 1px solid var(--choice-border);
}

.choice-inline-entry-fields .text_pole {
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-2);
}

.choice-inline-field-item {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-inline-field-label {
  white-space: nowrap;
  flex-shrink: 0;
}

.choice-inline-field-item .text_pole {
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-2);
}

.choice-cond-input {
  width: 100px;
  min-width: 0;
  flex-shrink: 1;
}

.choice-small-input {
  width: 40px;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: nowrap;
}

.choice-icon-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  cursor: pointer;
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--choice-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-icon-btn:hover:not(:disabled) {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-delete-btn {
  color: #c86a6a;
}

.choice-delete-btn:hover:not(:disabled) {
  color: #e07070;
}

.choice-empty-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-3);
  text-align: center;
}
</style>
