<template>
  <Teleport to="body">
    <div v-if="open" class="choice-sedlg-overlay" @click.self="onCancel">
      <div class="choice-sedlg-dialog">
        <div class="choice-sedlg-header">
          <span class="choice-sedlg-title">
            <i class="fa-solid fa-list-check"></i>
            {{ title }}
          </span>
          <div class="choice-sedlg-header-actions">
            <button
              class="choice-icon-btn"
              :title="allGroupsExpanded ? t`全部收起` : t`全部展开`"
              @click="toggleExpandAll"
            >
              <i :class="allGroupsExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
            </button>
            <button class="choice-sedlg-close" :title="t`取消`" @click="onCancel">&times;</button>
          </div>
        </div>

        <div class="choice-sedlg-body choice-scrollbar">
          <div v-if="masterPool.length > 0" class="choice-sedlg-list">
            <div v-for="group in groupedEntries" :key="group.key" class="choice-sedlg-group">
              <div class="choice-sedlg-group-head">
                <label class="choice-check" @click.stop>
                  <input type="checkbox" :checked="isGroupAllSelected(group)" @change="toggleSelectGroup(group)" />
                </label>
                <i
                  class="fa-solid"
                  :class="expandedGroups.has(group.key) ? 'fa-chevron-down' : 'fa-chevron-right'"
                  @click="toggleGroup(group.key)"
                ></i>
                <span class="choice-sedlg-group-name" @click="toggleGroup(group.key)">{{
                  group.key || t`未分组`
                }}</span>
                <span class="choice-sedlg-group-count" @click="toggleGroup(group.key)"
                  >({{ group.entries.length }})</span
                >
              </div>
              <div v-if="expandedGroups.has(group.key)" class="choice-sedlg-group-body">
                <div v-for="entry in group.entries" :key="entry.id" class="choice-sedlg-entry">
                  <label class="choice-check" @click.stop>
                    <input type="checkbox" :checked="pending.has(entry.id)" @change="toggleEntry(entry.id)" />
                    <span class="choice-sedlg-entry-text">{{ entrySummary(entry) }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="choice-empty-hint">
            <span>{{ t`条目库为空` }}</span>
          </div>
        </div>

        <div class="choice-sedlg-footer">
          <span class="choice-sedlg-count">{{ t`已选 ${pending.size} 条` }}</span>
          <button class="menu_button" @click="onCancel">{{ t`取消` }}</button>
          <button class="menu_button menu_button_default" @click="onConfirm">{{ t`确认` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { PoolEntry } from '@/type/settings';

const props = defineProps<{
  open: boolean;
  title: string;
  selectedIds: Set<string>;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [selectedIds: Set<string>];
}>();

const globalStore = useGlobalSettingsStore();
const masterPool = computed(() => globalStore.settings.master_pool);

const pending = ref<Set<string>>(new Set());
const expandedGroups = ref<Set<string>>(new Set());
const allGroupsExpanded = ref(false);

watch(
  () => props.open,
  val => {
    if (val) {
      pending.value = new Set(props.selectedIds);
      expandedGroups.value = new Set();
      allGroupsExpanded.value = false;
    }
  },
);

type EntryGroup = { key: string; entries: PoolEntry[] };

const groupedEntries = computed<EntryGroup[]>(() => {
  const map = new Map<string, PoolEntry[]>();
  for (const entry of masterPool.value) {
    const key = entry.category.trim() || '';
    let group = map.get(key);
    if (!group) {
      group = [];
      map.set(key, group);
    }
    group.push(entry);
  }
  const groups: EntryGroup[] = [];
  for (const [key, entries] of map) {
    groups.push({ key, entries });
  }
  groups.sort((a, b) => {
    if (!a.key) return 1;
    if (!b.key) return -1;
    return a.key.localeCompare(b.key);
  });
  return groups;
});

const entrySummary = (entry: PoolEntry): string => {
  const type = entry.type.trim();
  if (!type && !entry.content.trim()) return t`<空条目>`;
  return type.replace(/"/g, '').slice(0, 50);
};

const toggleGroup = (key: string) => {
  if (expandedGroups.value.has(key)) expandedGroups.value.delete(key);
  else expandedGroups.value.add(key);
};

const toggleExpandAll = () => {
  if (allGroupsExpanded.value) {
    expandedGroups.value = new Set();
    allGroupsExpanded.value = false;
  } else {
    expandedGroups.value = new Set(groupedEntries.value.map(g => g.key));
    allGroupsExpanded.value = true;
  }
};

const toggleEntry = (id: string) => {
  if (pending.value.has(id)) pending.value.delete(id);
  else pending.value.add(id);
};

const isGroupAllSelected = (group: EntryGroup) =>
  group.entries.length > 0 && group.entries.every(e => pending.value.has(e.id));

const toggleSelectGroup = (group: EntryGroup) => {
  if (isGroupAllSelected(group)) {
    for (const e of group.entries) pending.value.delete(e.id);
  } else {
    for (const e of group.entries) pending.value.add(e.id);
  }
};

const onConfirm = () => {
  emit('confirm', new Set(pending.value));
};

const onCancel = () => {
  emit('close');
};
</script>

<style scoped>
.choice-sedlg-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--choice-z-dialog);
  background: var(--choice-overlay);
  display: flex;
  justify-content: center;
  overflow-y: auto;
}

.choice-sedlg-dialog {
  width: 520px;
  max-width: 92vw;
  max-height: 80vh;
  margin: auto;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: inset 0 1px 0 var(--choice-frost-line), var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-sedlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-sedlg-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-sedlg-header-actions {
  display: inline-flex;
  gap: var(--choice-space-1);
  align-items: center;
}

.choice-sedlg-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-sedlg-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-sedlg-body {
  overflow-y: auto;
  padding: var(--choice-space-4);
  flex: 1;
}

.choice-sedlg-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-sedlg-group {
  display: flex;
  flex-direction: column;
}

.choice-sedlg-group-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-2);
  cursor: pointer;
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  border: 1px solid var(--choice-border);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  flex-wrap: wrap;
}

.choice-sedlg-group-head:hover {
  background: var(--choice-bg-hover);
}

.choice-sedlg-group-name {
  font-weight: bold;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-sedlg-group-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-sedlg-group-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--choice-space-1) 0 var(--choice-space-1) var(--choice-space-4);
}

.choice-sedlg-entry {
  padding: var(--choice-space-1) var(--choice-space-2);
  border-radius: var(--choice-radius-sm);
}

.choice-sedlg-entry:hover {
  background: var(--choice-bg-hover);
}

.choice-sedlg-entry-text {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-sedlg-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-3) var(--choice-space-4);
}

.choice-sedlg-count {
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  font-weight: bold;
  margin-right: auto;
}

.choice-icon-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  cursor: pointer;
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
  width: 28px;
  height: 28px;
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

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

.choice-empty-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-5) 0;
  text-align: center;
}
</style>
