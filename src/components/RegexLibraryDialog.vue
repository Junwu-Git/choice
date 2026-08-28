<template>
  <Teleport to="body">
    <div v-if="open" class="choice-regexlib-overlay" @click.self="emit('close')">
      <div class="choice-regexlib-dialog">
        <div class="choice-regexlib-header">
          <span class="choice-regexlib-title">
            <i class="fa-solid fa-code"></i>
            {{ t`正则库` }}
            <span class="choice-regexlib-count">({{ library.length }})</span>
          </span>
          <div class="choice-regexlib-header-actions">
            <button
              class="choice-icon-btn"
              :title="allGroupsExpanded ? t`全部收起` : t`全部展开`"
              @click="toggleExpandAll"
            >
              <i :class="allGroupsExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
            </button>
            <button class="choice-icon-btn" :title="t`新建分组`" @click="createGroup">
              <i class="fa-solid fa-folder-plus"></i>
            </button>
            <button class="choice-icon-btn" :title="t`导入文件`" @click="onImportFile">
              <i class="fa-solid fa-file-import"></i>
            </button>
            <button class="choice-icon-btn" :title="t`导出文件`" @click="onExport">
              <i class="fa-solid fa-file-export"></i>
            </button>
            <button class="choice-regexlib-close" :title="t`关闭`" @click="emit('close')">&times;</button>
          </div>
        </div>

        <div class="choice-regexlib-body choice-scrollbar">
          <div v-if="groupedEntries.length > 0" class="choice-regexlib-list">
            <div v-for="group in groupedEntries" :key="group.key" class="choice-regexlib-group">
              <div class="choice-regexlib-group-head" @click="toggleGroup(group.key)">
                <label class="choice-check" @click.stop v-if="selectable">
                  <input type="checkbox" :checked="isGroupAllSelected(group)" @change="toggleSelectGroup(group)" />
                </label>
                <i class="fa-solid" :class="expandedGroups.has(group.key) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
                <span v-if="groupRenameId !== group.key" class="choice-regexlib-group-name">{{
                  group.key || t`未分组`
                }}</span>
                <input
                  v-else
                  ref="groupRenameInput"
                  v-model="groupRenameText"
                  class="text_pole"
                  style="width: 120px; font-size: var(--choice-text-xs)"
                  @keydown.enter="finishGroupRename(group.key)"
                  @keydown.escape="cancelGroupRename"
                  @click.stop
                />
                <span class="choice-regexlib-group-count">({{ group.entries.length }})</span>
                <button
                  class="choice-icon-btn"
                  :title="groupRenameId === group.key ? t`保存` : t`重命名`"
                  @click.stop="groupRenameId === group.key ? finishGroupRename(group.key) : startGroupRename(group.key)"
                >
                  <i :class="groupRenameId === group.key ? 'fa-solid fa-check' : 'fa-solid fa-pen-to-square'"></i>
                </button>
                <button
                  v-if="groupRenameId === group.key"
                  class="choice-icon-btn"
                  :title="t`取消`"
                  @click.stop="cancelGroupRename"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
                <button class="choice-icon-btn" :title="t`添加条目`" @click.stop="addEntryToGroup(group.key)">
                  <i class="fa-solid fa-plus"></i>
                </button>
                <button
                  class="choice-icon-btn choice-delete-btn"
                  :title="t`删除分组`"
                  @click.stop="deleteGroupTarget = group.key"
                >
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
              <div :class="['choice-regexlib-group-body', { 'is-collapsed': !expandedGroups.has(group.key) }]">
                <div v-if="group.entries.length === 0" class="choice-empty-hint">
                  <span>{{ t`暂无条目，点击 + 添加` }}</span>
                </div>
                <div v-for="entry in group.entries" :key="entry.id" class="choice-regexlib-entry">
                  <label class="choice-check" v-if="selectable">
                    <input type="checkbox" :checked="selectedIds.has(entry.id)" @change="toggleSelect(entry.id)" />
                  </label>
                  <select v-model="entry.type" class="text_pole" style="width: 90px; flex-shrink: 0">
                    <option value="tag">{{ t`标签匹配` }}</option>
                    <option value="regex">{{ t`正则表达式` }}</option>
                  </select>
                  <template v-if="entry.type === 'tag'">
                    <input
                      v-model="entry.start"
                      class="text_pole"
                      :placeholder="t`标签头`"
                      style="flex: 1; min-width: 0"
                    />
                    <input
                      v-model="entry.end"
                      class="text_pole"
                      :placeholder="t`标签尾`"
                      style="flex: 1; min-width: 0"
                    />
                  </template>
                  <input
                    v-else
                    v-model="entry.pattern"
                    class="text_pole"
                    :placeholder="t`正则表达式`"
                    style="flex: 1; min-width: 0"
                  />
                  <button class="choice-icon-btn choice-delete-btn" @click="removeEntry(entry.id)">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="choice-empty-hint">
            <span>{{ t`暂无正则条目，请点击「新建分组」创建` }}</span>
          </div>
        </div>

        <div v-if="selectable" class="choice-regexlib-footer">
          <button class="choice-btn-sm choice-btn-new" :disabled="selectedIds.size === 0" @click="confirmSelection">
            <i class="fa-solid fa-check"></i> {{ t`确认添加` }} ({{ selectedIds.size }})
          </button>
          <button class="choice-btn-sm" @click="emit('close')">{{ t`取消` }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <ConfirmDialog
    :open="deleteGroupTarget !== null"
    :title="t`删除分组`"
    :message="t`确定要删除该分组及其所有条目吗？`"
    :confirm-text="t`删除`"
    :cancel-text="t`取消`"
    @confirm="onDeleteGroupConfirm"
    @cancel="deleteGroupTarget = null"
  />
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import type { RegexLibraryEntry } from '@/type/settings';
import { uuidv4 } from '@sillytavern/scripts/utils';

const props = withDefaults(
  defineProps<{
    open: boolean;
    selectable?: boolean;
    alreadyReferencedIds?: Set<string>;
  }>(),
  {
    selectable: false,
    alreadyReferencedIds: () => new Set(),
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [ids: string[]];
}>();

const gs = useGlobalSettingsStore();
const library = computed(() => gs.settings.filter_settings.regex_library);

const expandedGroups = ref<Set<string>>(new Set());
const groupRenameId = ref<string | null>(null);
const groupRenameText = ref('');
const deleteGroupTarget = ref<string | null>(null);
const selectedIds = ref<Set<string>>(new Set());

const allGroupsExpanded = computed(() => {
  const groups = new Set(library.value.map(e => e.category));
  return groups.size > 0 && [...groups].every(k => expandedGroups.value.has(k));
});

const groupedEntries = computed(() => {
  const map = new Map<string, RegexLibraryEntry[]>();
  for (const entry of library.value) {
    const cat = entry.category || '';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(entry);
  }
  const result = [...map.entries()].map(([key, entries]) => ({ key, entries }));
  const order = gs.settings.group_order ?? [];
  result.sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    if (ai === -1 && bi === -1) return a.key.localeCompare(b.key);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return result;
});

const toggleGroup = (key: string) => {
  if (expandedGroups.value.has(key)) {
    expandedGroups.value.delete(key);
  } else {
    expandedGroups.value.add(key);
  }
};

const toggleExpandAll = () => {
  if (allGroupsExpanded.value) {
    expandedGroups.value = new Set();
  } else {
    expandedGroups.value = new Set([...new Set(library.value.map(e => e.category))]);
  }
};

const isGroupAllSelected = (group: { key: string; entries: RegexLibraryEntry[] }) => {
  return group.entries.length > 0 && group.entries.every(e => selectedIds.value.has(e.id));
};

const toggleSelectGroup = (group: { key: string; entries: RegexLibraryEntry[] }) => {
  if (isGroupAllSelected(group)) {
    for (const e of group.entries) selectedIds.value.delete(e.id);
  } else {
    for (const e of group.entries) selectedIds.value.add(e.id);
  }
};

const toggleSelect = (id: string) => {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id);
  } else {
    selectedIds.value.add(id);
  }
};

const confirmSelection = () => {
  emit('confirm', [...selectedIds.value]);
  emit('close');
};

const createGroup = () => {
  const name = prompt(t`请输入分组名称`);
  if (!name || !name.trim()) return;
  const cat = name.trim();
  gs.addRegexLibraryEntry(cat);
  expandedGroups.value.add(cat);
};

const addEntryToGroup = (category: string) => {
  const entry = gs.addRegexLibraryEntry(category);
  expandedGroups.value.add(category);
};

const removeEntry = (id: string) => {
  gs.removeRegexLibraryEntry(id);
};

const startGroupRename = (key: string) => {
  groupRenameId.value = key;
  groupRenameText.value = key;
};

const finishGroupRename = (oldKey: string) => {
  const newKey = groupRenameText.value.trim();
  if (newKey && newKey !== oldKey) {
    gs.renameRegexLibraryGroup(oldKey, newKey);
  }
  groupRenameId.value = null;
};

const cancelGroupRename = () => {
  groupRenameId.value = null;
};

const onDeleteGroupConfirm = () => {
  if (deleteGroupTarget.value !== null) {
    gs.deleteRegexLibraryGroup(deleteGroupTarget.value);
    deleteGroupTarget.value = null;
  }
};

const onExport = () => {
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: library.value }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `choice-regex-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const onImportFile = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const fs = gs.settings.filter_settings;
      // ST 原生正则格式：包含 script_name / findRegex 字段
      if (Array.isArray(data) && data.length > 0 && data[0].findRegex !== undefined) {
        const existingIds = new Set(fs.regex_library.map(e => e.id));
        let added = 0;
        for (const item of data) {
          const entryId = uuidv4();
          if (existingIds.has(entryId)) continue;
          const entry: RegexLibraryEntry = {
            id: entryId,
            name: item.script_name || '',
            type: 'regex',
            pattern: item.findRegex || '',
            start: '',
            end: '',
            category: '',
          };
          fs.regex_library.push(entry);
          added++;
        }
        toastr.success(t`已从 ST 格式导入 ${added} 条正则`);
        return;
      }
      if (!data.entries || !Array.isArray(data.entries)) throw new Error('格式不正确');
      const existingIds = new Set(fs.regex_library.map(e => e.id));
      let added = 0;
      for (const entry of data.entries) {
        if (!existingIds.has(entry.id)) {
          fs.regex_library.push({ ...entry, id: entry.id || uuidv4() });
          added++;
        }
      }
      toastr.success(t`已导入 ${added} 条正则`);
    } catch (err) {
      toastr.error(t`导入失败：${err instanceof Error ? err.message : '无效文件'}`);
    }
  };
  input.click();
};

watch(
  () => props.open,
  isOpen => {
    if (isOpen) {
      selectedIds.value = new Set(props.alreadyReferencedIds);
      expandedGroups.value = new Set([...new Set(library.value.map(e => e.category))]);
    }
  },
);
</script>

<style scoped>
.choice-regexlib-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--choice-z-floating);
  background: var(--choice-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}
.choice-regexlib-dialog {
  width: 700px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.choice-regexlib-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  border-bottom: 1px solid var(--choice-border);
  background: var(--choice-bg-card);
}
.choice-regexlib-title {
  font-size: var(--choice-text-base);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  color: var(--choice-text);
}
.choice-regexlib-count {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
  font-weight: 400;
}
.choice-regexlib-header-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}
.choice-regexlib-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.choice-regexlib-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}
.choice-regexlib-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--choice-space-3);
}
.choice-regexlib-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}
.choice-regexlib-group {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
}
.choice-regexlib-group-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  background: var(--choice-bg-card);
  cursor: pointer;
  font-size: var(--choice-text-sm);
  user-select: none;
}
.choice-regexlib-group-head:hover {
  background: rgba(128, 128, 128, 0.05);
}
.choice-regexlib-group-name {
  flex: 1;
  font-weight: 600;
  color: var(--choice-text-secondary);
}
.choice-regexlib-group-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}
.choice-regexlib-group-body {
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}
.choice-regexlib-group-body.is-collapsed {
  display: none;
}
.choice-regexlib-entry {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}
.choice-regexlib-entry input {
  font-size: var(--choice-text-sm);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}
.choice-regexlib-entry input:focus {
  border-color: var(--choice-border-active);
  outline: none;
}
.choice-regexlib-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  padding: var(--choice-space-3) var(--choice-space-4);
  border-top: 1px solid var(--choice-border);
  background: var(--choice-bg-card);
}
</style>
