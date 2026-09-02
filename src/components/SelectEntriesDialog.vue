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
          <div v-if="masterPool.length > 0" class="choice-sedlg-list" data-tour="select-entries-list">
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
                  <div class="choice-sedlg-entry-row">
                    <label class="choice-check" @click.stop>
                      <input type="checkbox" :checked="pending.has(entry.id)" @change="toggleEntry(entry.id)" />
                    </label>
                    <i
                      class="fa-solid choice-sedlg-expand"
                      :class="expandedEntries.has(entry.id) ? 'fa-chevron-down' : 'fa-chevron-right'"
                      :title="t`查看条目内容与规则`"
                      @click.stop="toggleExpandEntry(entry.id)"
                    ></i>
                    <span class="choice-sedlg-entry-text" @click="toggleExpandEntry(entry.id)">{{
                      entrySummary(entry)
                    }}</span>
                  </div>
                  <!-- 只读详情：条目内容/规则属于条目库，此处仅展示，编辑请去条目库弹窗 -->
                  <div v-if="expandedEntries.has(entry.id)" class="choice-sedlg-entry-detail">
                    <div v-for="field in entryDetailFields(entry)" :key="field.label" class="choice-sedlg-detail-item">
                      <span class="choice-sedlg-detail-label">{{ field.label }}</span>
                      <div class="choice-sedlg-detail-text">{{ field.value }}</div>
                    </div>
                    <div v-if="entryDetailFields(entry).length === 0" class="choice-sedlg-detail-empty">
                      {{ t`该条目无内容与规则` }}
                    </div>
                  </div>
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
// 条目只读详情展开态；弹窗每次打开时重置
const expandedEntries = ref<Set<string>>(new Set());

watch(
  () => props.open,
  val => {
    if (val) {
      pending.value = new Set(props.selectedIds);
      expandedGroups.value = new Set();
      allGroupsExpanded.value = false;
      expandedEntries.value = new Set();
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

// 折叠摘要只显示条目标识，与 PoolEditor.entrySummary 同格式；完整内容/规则仅在展开详情出现
const entrySummary = (entry: PoolEntry): string => {
  const type = entry.type.trim();
  if (type) return type.replace(/"/g, '').slice(0, 50);
  const content = entry.content.trim();
  // 无类型的条目以内容首段充当标识，否则折叠行全空白
  if (content) return content.replace(/"/g, '').slice(0, 30);
  return t`<空条目>`;
};

type DetailField = { label: string; value: string };

// 只读详情字段：内容/规则非空才显示对应块；两块都空时由模板的空态分支兜底
const entryDetailFields = (entry: PoolEntry): DetailField[] => {
  const fields: DetailField[] = [];
  if (entry.content.trim()) fields.push({ label: t`内容`, value: entry.content });
  if (entry.rule.trim()) fields.push({ label: t`规则`, value: entry.rule });
  return fields;
};

const toggleExpandEntry = (id: string) => {
  if (expandedEntries.value.has(id)) expandedEntries.value.delete(id);
  else expandedEntries.value.add(id);
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
  /* 同 dvh 回退：手机上 100vh 按布局视口取值，大于可视高度 */
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-dialog);
  background: var(--choice-overlay);
  display: flex;
  justify-content: center;
  overflow-y: auto;
  /* 触屏上拖到边缘禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
}

.choice-sedlg-dialog {
  width: 520px;
  max-width: 92vw;
  /* 同 dvh 回退 */
  max-height: 80vh;
  max-height: 80dvh;
  margin: auto;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
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
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
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

.choice-sedlg-entry-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-sedlg-expand {
  cursor: pointer;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.choice-sedlg-entry-detail {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) 0 var(--choice-space-1) var(--choice-space-4);
  margin-top: 2px;
  border-top: 1px dashed var(--choice-border);
}

.choice-sedlg-detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.choice-sedlg-detail-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-sedlg-detail-text {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

.choice-sedlg-detail-empty {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-sedlg-entry-text {
  flex: 1;
  min-width: 0;
  cursor: pointer;
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

/* 对齐 global.css 的贴内容语义：label 不撑满，分组名/条目摘要用自身 flex:1 填满，
   否则 label 撑满会把箭头+名称挤到行中央（与条目库不一致的居中观感） */
.choice-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.choice-empty-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-5) 0;
  text-align: center;
}
</style>
