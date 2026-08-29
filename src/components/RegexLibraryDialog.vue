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
            <button class="choice-icon-btn" :title="t`从酒馆正则导入`" @click="showStImport = true">
              <i class="fa-solid fa-cloud-arrow-down"></i>
            </button>
            <button class="choice-icon-btn" :title="t`导出文件`" @click="onExport">
              <i class="fa-solid fa-file-export"></i>
            </button>
            <button class="choice-regexlib-close" :title="t`关闭`" @click="emit('close')">&times;</button>
          </div>
        </div>

        <div ref="listBody" class="choice-regexlib-body choice-scrollbar">
          <div v-if="groupedEntries.length > 0" ref="groupListEl" class="choice-regexlib-list">
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
              <div
                :class="['choice-regexlib-group-body', { 'is-collapsed': !expandedGroups.has(group.key) }]"
                :data-group-key="group.key"
              >
                <div v-if="group.entries.length === 0" class="choice-empty-hint">
                  <span>{{ t`暂无条目，点击 + 添加` }}</span>
                </div>
                <div
                  v-for="entry in group.entries"
                  :key="entry.id"
                  class="choice-regexlib-entry"
                  :data-entry-id="entry.id"
                >
                  <i class="fa-solid fa-grip-vertical choice-regexlib-drag-handle" :title="t`拖动排序/换组`"></i>
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
                  <input
                    v-if="entry.type === 'regex'"
                    v-model="entry.replace"
                    class="text_pole choice-regexlib-replace"
                    :placeholder="t`替换为（留空=删除）`"
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

  <!-- 从酒馆三区（全局/预设/角色卡）勾选导入：入口在正则库头部，条目写入正则库的目标分组（category） -->
  <StRegexImportDialog :open="open && showStImport" @close="showStImport = false" />
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import type { RegexLibraryEntry } from '@/type/settings';
import { mapStScriptToLibraryEntry } from '@/core/st-regex-source';
import StRegexImportDialog from '@/components/StRegexImportDialog.vue';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { draggableFilterOptions } from '@/util/sortable';
import Sortable from 'sortablejs';

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
// 从酒馆正则导入弹窗（随本弹窗关闭而关闭：open 由父级 open && showStImport 联合控制）
const showStImport = ref(false);

const allGroupsExpanded = computed(() => {
  const groups = new Set(groupedEntries.value.map(g => g.key));
  return groups.size > 0 && [...groups].every(k => expandedGroups.value.has(k));
});

const groupedEntries = computed(() => {
  const map = new Map<string, RegexLibraryEntry[]>();
  for (const entry of library.value) {
    const cat = entry.category || '';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(entry);
  }
  // 从 library_groups 补上无条目的空分组
  const libGroups = gs.settings.filter_settings.library_groups ?? [];
  for (const cat of libGroups) {
    if (!map.has(cat)) {
      map.set(cat, []);
    }
  }
  const result = [...map.entries()].map(([key, entries]) => ({ key, entries }));
  result.sort((a, b) => {
    const ai = libGroups.indexOf(a.key);
    const bi = libGroups.indexOf(b.key);
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
    expandedGroups.value = new Set(groupedEntries.value.map(g => g.key));
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
  const groups = gs.settings.filter_settings.library_groups ?? [];
  if (!groups.includes(cat)) {
    groups.push(cat);
  }
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
      const existingIds = new Set(fs.regex_library.map(e => e.id));
      const imported: RegexLibraryEntry[] = [];
      let invalid = 0;
      let duplicated = 0;

      // ST 原生正则脚本判定（酒馆正则扩展导出格式，字段以酒馆源码为准：scriptName 驼峰 / findRegex / replaceString）。
      // 映射逻辑（剥 /…/flags、填 replace）与"从酒馆正则区导入"弹窗共享 st-regex-source，避免两处实现漂移。
      const isStScript = (item: any) => typeof item?.findRegex === 'string';

      // 插件自有格式条目（本插件导出文件的 entries 内元素，或裸数组中的同类条目）：
      // 补默认字段；按原 id 去重——重复导入同一份导出文件时跳过已有条目
      const importPluginEntry = (raw: any): RegexLibraryEntry | null => {
        if (!raw || typeof raw !== 'object') return null;
        if ((raw.type !== 'tag' && raw.type !== 'regex') || typeof raw.pattern !== 'string') return null;
        const id = typeof raw.id === 'string' && raw.id ? raw.id : uuidv4();
        return {
          id,
          name: raw.name ?? '',
          type: raw.type,
          pattern: raw.pattern,
          replace: raw.replace ?? '',
          start: raw.start ?? '',
          end: raw.end ?? '',
          category: raw.category ?? '',
        };
      };

      // 归一化为待判定列表：兼容 ST 单对象 / ST 数组 / 插件 { entries } / 插件条目裸数组
      const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : [data];
      for (const item of items) {
        if (isStScript(item)) {
          imported.push(mapStScriptToLibraryEntry(item));
          continue;
        }
        if (item && typeof item === 'object' && typeof item.id === 'string' && item.id && existingIds.has(item.id)) {
          duplicated++;
          continue;
        }
        const entry = importPluginEntry(item);
        if (entry) {
          existingIds.add(entry.id);
          imported.push(entry);
        } else {
          invalid++;
        }
      }
      if (imported.length === 0) {
        // 全部为重复项不是失败，单独提示，避免误报"导入失败"
        if (duplicated > 0) {
          toastr.info(t`${duplicated} 条正则均已存在，未重复导入`);
          return;
        }
        throw new Error('未识别到可导入的正则条目');
      }
      fs.regex_library.push(...imported);
      const parts = [t`已导入 ${imported.length} 条正则`];
      if (duplicated > 0) parts.push(t`去重 ${duplicated} 条重复项`);
      if (invalid > 0) parts.push(t`跳过 ${invalid} 条无效项`);
      toastr.success(parts.join('，'));
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
      // 全部分组展开：条目行为单行输入区，展开即可见全部正则
      expandedGroups.value = new Set(groupedEntries.value.map(g => g.key));
      setupSortables();
    }
  },
  { flush: 'post' },
);

// 分组条目变化时重新挂载 Sortable
watch(
  () => groupedEntries.value,
  () => {
    if (props.open) setupSortables();
  },
  { flush: 'post' },
);

onMounted(() => {
  if (props.open) setupSortables();
});

// 正则库条目拖拽
const listBody = ref<HTMLElement | null>(null);
const groupListEl = ref<HTMLElement | null>(null);
const sortables: Sortable[] = [];

// 拖拽悬停自动展开：折叠分组体只剩 4px 隐形投放带，靠它命中体感是"等很久"。
// 拖拽期间监听 document dragover，指针进入某分组任意区域即展开该组（折叠机制本身保留，此处只是消除命中难度）。
// 必须用捕获阶段：SortableJS 在容器上绑定了 dragover 并阻断冒泡，气泡阶段监听永远收不到事件
const onDragHoverExpand = (e: DragEvent) => {
  const group = (e.target as Element | null)?.closest?.('.choice-regexlib-group');
  const key = group?.querySelector('.choice-regexlib-group-body')?.getAttribute('data-group-key');
  if (key && !expandedGroups.value.has(key)) expandedGroups.value.add(key);
};

// Sortable 的 onEnd 在拖拽结束（无论是否成功投放）都会触发，监听清理可靠；onUnmounted 再兜底
const attachHoverExpand = () => document.addEventListener('dragover', onDragHoverExpand, true);
const detachHoverExpand = () => document.removeEventListener('dragover', onDragHoverExpand, true);

function setupSortables() {
  destroySortables();
  const el = listBody.value;
  if (el) {
    const bodies = el.querySelectorAll<HTMLElement>('.choice-regexlib-group-body');
    for (const body of bodies) {
      sortables.push(
        Sortable.create(body, {
          ...draggableFilterOptions,
          animation: 150,
          group: 'regex-lib-entries',
          draggable: '.choice-regexlib-entry',
          // 行内几乎全是 input/select，原生拖拽无法从表单控件发起——限定从左侧把手发起。
          // delay 区分点击与拖拽：100ms 内松手 = 点击控件，按住再移动 = 拖拽
          handle: '.choice-regexlib-drag-handle',
          delay: 100,
          onStart: attachHoverExpand,
          onEnd: evt => {
            detachHoverExpand();
            if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
            const entryId = evt.item.dataset.entryId;
            if (!entryId) return;
            const fromKey = (evt.from as HTMLElement).dataset.groupKey;
            const toKey = (evt.to as HTMLElement).dataset.groupKey;
            if (fromKey === toKey && evt.from === evt.to) {
              const cat = fromKey ?? '';
              const catEntries = library.value.filter(e => (e.category || '') === cat);
              const entry = catEntries.find(e => e.id === entryId);
              if (!entry) return;
              const fromIdx = catEntries.indexOf(entry);
              if (fromIdx === -1) return;
              const [moved] = catEntries.splice(fromIdx, 1);
              catEntries.splice(evt.newIndex, 0, moved);
              const flat = library.value.filter(e => (e.category || '') !== cat);
              for (const e of catEntries) flat.push(e);
              gs.settings.filter_settings.regex_library = flat;
            } else if (fromKey !== toKey) {
              const entry = library.value.find(e => e.id === entryId);
              if (!entry) return;
              entry.category = toKey ?? '';
              expandedGroups.value.add(toKey ?? '');
            }
          },
        }),
      );
    }
  }
  // 分组头拖拽排序：重排 library_groups（只写回其中已有的 key，避免把"未分组"空 key 写入）
  const listEl = groupListEl.value;
  if (listEl) {
    sortables.push(
      Sortable.create(listEl, {
        ...draggableFilterOptions,
        draggable: '.choice-regexlib-group',
        delay: 100,
        animation: 150,
        onStart: attachHoverExpand,
        onEnd: evt => {
          detachHoverExpand();
          if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
          const keys = groupedEntries.value.map(g => g.key);
          const [moved] = keys.splice(evt.oldIndex, 1);
          keys.splice(evt.newIndex, 0, moved);
          const groups = gs.settings.filter_settings.library_groups ?? [];
          const newOrder = keys.filter(k => groups.includes(k));
          groups.length = 0;
          for (const k of newOrder) groups.push(k);
        },
      }),
    );
  }
}

function destroySortables() {
  for (const s of sortables) s.destroy();
  sortables.length = 0;
}

onUnmounted(() => {
  detachHoverExpand();
  destroySortables();
});
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
  width: 600px;
  max-width: 92vw;
  max-height: 85vh;
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
/* 折叠用 max-height 而非 display:none：body 仍占 4px 高度留在布局中，
   SortableJS 才能把它识别为 drop target（拖入折叠分组后 onEnd 自动展开） */
.choice-regexlib-group-body {
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  max-height: 2000px;
  overflow: hidden;
  opacity: 1;
  transition:
    max-height var(--choice-transition-slow, 0.2s ease),
    opacity var(--choice-transition-slow, 0.2s ease),
    padding var(--choice-transition-slow, 0.2s ease);
}
.choice-regexlib-group-body.is-collapsed {
  max-height: 4px;
  padding: 0;
  opacity: 0;
}
/* 条目行：单行布局，输入控件直接可见，从左侧把手拖拽 */
.choice-regexlib-entry {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}
.choice-regexlib-drag-handle {
  cursor: grab;
  color: var(--choice-text-muted);
  flex-shrink: 0;
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-1) 2px;
}
.choice-regexlib-drag-handle:hover {
  color: var(--choice-text);
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
/* 替换为：导入 ST 正则时承载 replaceString（如 $1 保留内容只去标签壳），留空 = 整段删除 */
.choice-regexlib-replace {
  width: 110px;
  flex-shrink: 0;
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
