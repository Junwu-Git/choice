<template>
  <div class="choice-pool-editor">
    <!-- 配置工具栏 -->
    <div class="choice-config-bar">
      <div class="choice-config-row">
        <label class="choice-config-label">{{ t`配置` }}</label>
        <select v-model="selectedConfigId" class="text_pole choice-config-select">
          <option v-for="cfg in configs" :key="cfg.id" :value="cfg.id">{{ cfg.name }}</option>
        </select>
        <button class="choice-btn-sm" :title="t`重命名`" :disabled="!selectedConfig" @click="startRenameConfig">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
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
              <i
                class="fa-solid choice-inline-expand"
                :class="expandedEntries.has(cfgEntry.entry_id) ? 'fa-chevron-down' : 'fa-chevron-right'"
                :title="t`查看条目内容与规则`"
                @click="toggleExpandEntry(cfgEntry.entry_id)"
              ></i>
              <span class="choice-inline-entry-text" @click="toggleExpandEntry(cfgEntry.entry_id)">
                <span
                  class="choice-inline-cat-badge"
                  :class="{ 'choice-inline-cat-badge--muted': !getEntryCategory(cfgEntry.entry_id) }"
                  >{{ getEntryCategory(cfgEntry.entry_id) || t`未分组` }}</span
                >
                {{ entrySummary(cfgEntry.entry_id) }}
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
                <button
                  class="choice-icon-btn choice-delete-btn"
                  :title="t`移除`"
                  @click="removeConfigEntry(cfgEntry.entry_id)"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>
            <!-- 只读详情：content/rule/category 只存在于 master_pool（内容层唯一真相源），
                 配置层不持有这些字段，这里只做展示，编辑请去条目库 -->
            <div v-if="expandedEntries.has(cfgEntry.entry_id)" class="choice-inline-entry-detail">
              <template v-if="masterEntryOf(cfgEntry.entry_id)">
                <div
                  v-for="field in entryDetailFields(cfgEntry.entry_id)"
                  :key="field.label"
                  class="choice-inline-detail-item"
                >
                  <span class="choice-inline-detail-label">{{ field.label }}</span>
                  <div class="choice-inline-detail-text">{{ field.value }}</div>
                </div>
                <div v-if="entryDetailFields(cfgEntry.entry_id).length === 0" class="choice-inline-detail-empty">
                  {{ t`该条目无内容与规则` }}
                </div>
              </template>
              <div v-else class="choice-inline-detail-empty">{{ t`条目已不存在` }}</div>
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

    <CreateConfigDialog
      :open="showCreateDialog"
      :existing-names="configs.map(c => c.name)"
      @close="showCreateDialog = false"
      @create="onCreateConfig"
    />

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
import toastr from 'toastr';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { PoolConfig, PoolEntry } from '@/type/settings';
import { GenerationSettings } from '@/type/settings';
import { draggableFilterOptions } from '@/util/sortable';
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
    // 用 schema 默认而非硬编码字面量：避免字段遗漏（曾漏 count_mode）与默认值漂移
    generation: GenerationSettings.parse({}),
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

const startRenameConfig = () => {
  if (!selectedConfig.value) return;
  const name = prompt(t`请输入新名称`, selectedConfig.value.name);
  const trimmed = name?.trim();
  if (!trimmed || trimmed === selectedConfig.value.name) return;
  // 重名检测：与其他配置同名会让下拉/绑定歧义，提醒后放弃修改
  if (configs.value.some(c => c.id !== selectedConfig.value!.id && c.name === trimmed)) {
    toastr.warning(t`配置名「${trimmed}」已存在`);
    return;
  }
  selectedConfig.value.name = trimmed;
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

// 展开态按 entry_id 记录；切换配置时清空，避免残留指向其他配置条目的展开态
const expandedEntries = ref<Set<string>>(new Set());
watch(selectedConfigId, () => expandedEntries.value = new Set());

const toggleExpandEntry = (entryId: string) => {
  if (expandedEntries.value.has(entryId)) expandedEntries.value.delete(entryId);
  else expandedEntries.value.add(entryId);
};

const masterEntryOf = (entryId: string): PoolEntry | undefined =>
  masterPool.value.find(e => e.id === entryId);

const getEntryCategory = (entryId: string): string => {
  const entry = masterEntryOf(entryId);
  return entry?.category?.trim() || '';
};

// 折叠摘要只显示条目标识：完整内容/规则仅在展开详情出现，避免同一内容两处重复
const entrySummary = (entryId: string): string => {
  const entry = masterEntryOf(entryId);
  if (!entry) return t`<空条目>`;
  const type = entry.type.trim();
  if (type) return type.replace(/"/g, '').slice(0, 50);
  const content = entry.content.trim();
  // 无类型的条目以内容首段充当标识，否则折叠行全空白
  if (content) return content.replace(/"/g, '').slice(0, 30);
  return t`<空条目>`;
};

type DetailField = { label: string; value: string };

// 只读详情字段：内容/规则均非空才显示对应块；条目已被从条目库删除时返回空数组，
// 由模板的"条目已不存在"分支兜底
const entryDetailFields = (entryId: string): DetailField[] => {
  const entry = masterEntryOf(entryId);
  if (!entry) return [];
  const fields: DetailField[] = [];
  if (entry.content.trim()) fields.push({ label: t`内容`, value: entry.content });
  if (entry.rule.trim()) fields.push({ label: t`规则`, value: entry.rule });
  return fields;
};

const removeConfigEntry = (entryId: string) => {
  if (!selectedConfig.value) return;
  const idx = selectedConfig.value.entries.findIndex(e => e.entry_id === entryId);
  if (idx !== -1) selectedConfig.value.entries.splice(idx, 1);
  expandedEntries.value.delete(entryId);
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
      const src = masterEntryOf(id);
      selectedConfig.value.entries.push({
        entry_id: id,
        pinned: src?.pinned ?? false,
        weight: src?.weight ?? 1,
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
        ...draggableFilterOptions,
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
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-inline-gen-item .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-inline-gen-item select.text_pole {
  width: auto;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-inline-gen-item select.text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-inline-entries {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  max-height: 250px;
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
  flex-shrink: 0;
}

.choice-inline-entry-row {
  display: flex;
  align-items: center;
  gap: 0;
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
  cursor: pointer;
}

.choice-inline-expand {
  cursor: pointer;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  flex-shrink: 0;
  padding-left: var(--choice-space-2);
}

.choice-inline-entry-detail {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) var(--choice-space-2) var(--choice-space-2) var(--choice-space-4);
  border-top: 1px solid var(--choice-border);
}

.choice-inline-detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.choice-inline-detail-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-inline-detail-text {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

.choice-inline-detail-empty {
  font-size: var(--choice-text-xs);
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
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-inline-entry-fields .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
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
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-inline-field-item .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-small-input {
  width: 40px;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-small-input:focus {
  border-color: var(--choice-border-active);
  outline: none;
}
</style>
