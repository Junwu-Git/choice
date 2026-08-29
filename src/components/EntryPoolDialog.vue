<template>
  <Teleport to="body">
    <div v-if="open" class="choice-epool-overlay" @click.self="emit('close')">
      <div class="choice-epool-dialog">
        <div class="choice-epool-header">
          <span class="choice-epool-title">
            <i class="fa-solid fa-database"></i>
            {{ t`条目库` }}
            <span class="choice-epool-count">({{ masterPool.length }})</span>
          </span>
          <div class="choice-epool-header-actions">
            <button
              class="choice-icon-btn"
              :title="allGroupsExpanded ? t`全部收起` : t`全部展开`"
              @click="toggleExpandAllGroups"
            >
              <i :class="allGroupsExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
            </button>
            <button class="choice-icon-btn" :title="t`新建分组`" @click="createGroup">
              <i class="fa-solid fa-folder-plus"></i>
            </button>
            <button class="choice-icon-btn" :title="t`导入文件`" @click="onImportFile">
              <i class="fa-solid fa-file-import"></i>
            </button>
            <button class="choice-icon-btn" :title="t`导出文件`" @click="onExportPool">
              <i class="fa-solid fa-file-export"></i>
            </button>
            <button class="choice-icon-btn" :title="t`AI 生成`" @click="showGen = true">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
            </button>
            <button ref="guideBtn" class="choice-icon-btn" :title="t`页面指引`" @click="showGuide = !showGuide">
              <i class="fa-solid fa-circle-question"></i>
            </button>
            <button class="choice-epool-close" :title="t`关闭`" @click="emit('close')">&times;</button>
          </div>
        </div>

        <div class="choice-epool-body choice-scrollbar">
          <div v-if="groupedEntries.length > 0" ref="groupList" class="choice-epool-list">
            <div
              v-for="group in groupedEntries"
              :key="group.key"
              class="choice-epool-group"
              :data-group-key="group.key"
            >
              <div class="choice-epool-group-head" @click="toggleGroup(group.key)">
                <label class="choice-check" @click.stop>
                  <input type="checkbox" :checked="isGroupAllSelected(group)" @change="toggleSelectGroup(group)" />
                </label>
                <i class="fa-solid" :class="expandedGroups.has(group.key) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
                <span v-if="groupRenameId !== group.key" class="choice-epool-group-name">{{
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
                <span class="choice-epool-group-count">({{ group.entries.length }})</span>
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
                <button class="choice-icon-btn" :title="t`复制全部`" @click.stop="copyGroup(group)">
                  <i class="fa-solid fa-copy"></i>
                </button>
                <button
                  class="choice-icon-btn choice-delete-btn"
                  :title="t`删除分组`"
                  @click.stop="deleteTarget = { type: 'group', key: group.key, count: group.entries.length }"
                >
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
              <div
                :class="['choice-epool-group-body', { 'is-collapsed': !expandedGroups.has(group.key) }]"
                :data-group-key="group.key"
              >
                <div v-if="group.entries.length === 0" class="choice-empty-hint">
                  <span>{{ t`暂无条目，点击 + 添加` }}</span>
                </div>
                <div
                  v-for="entry in group.entries"
                  :key="entry.id"
                  class="choice-epool-entry"
                  :data-entry-id="entry.id"
                >
                  <div class="choice-epool-entry-head">
                    <label class="choice-check" @click.stop>
                      <input type="checkbox" :checked="selected.has(entry.id)" @change="toggleSelectEntry(entry.id)" />
                    </label>
                    <i
                      class="fa-solid"
                      :class="expanded.has(entry.id) ? 'fa-chevron-down' : 'fa-chevron-right'"
                      @click="toggleEntry(entry.id)"
                    ></i>
                    <span class="choice-epool-entry-summary" @click="toggleEntry(entry.id)">{{
                      entrySummary(entry)
                    }}</span>
                    <span v-if="entry.pinned" class="choice-pin-badge">📌</span>
                    <select
                      :value="entry.category"
                      class="text_pole choice-cat-select"
                      :title="t`移动到分组`"
                      @change="onEntryCategoryChange(entry, ($event.target as HTMLSelectElement).value)"
                      @click.stop
                    >
                      <option value="">{{ t`未分组` }}</option>
                      <option v-for="cat in categoryNames" :key="cat" :value="cat">{{ cat }}</option>
                    </select>
                    <button
                      class="choice-icon-btn choice-delete-btn"
                      :title="t`删除`"
                      @click.stop="deleteTarget = { type: 'entry', id: entry.id, summary: entrySummary(entry) }"
                    >
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                  <div v-if="expanded.has(entry.id)" class="choice-epool-entry-body">
                    <input v-model="entry.type" class="text_pole" :placeholder="t`条目类型(短标签)`" />
                    <textarea
                      v-model="entry.content"
                      class="text_pole"
                      :placeholder="t`AI 生成指令`"
                      rows="2"
                    ></textarea>
                    <input v-model="entry.rule" class="text_pole" :placeholder="t`规则(可选)`" />
                    <div class="choice-epool-entry-fields">
                      <label class="choice-check">
                        <input v-model="entry.pinned" type="checkbox" />
                        {{ t`固定` }}
                      </label>
                      <input
                        v-model.number="entry.weight"
                        class="text_pole choice-small-input"
                        type="number"
                        min="0"
                        :title="t`权重(加权随机)`"
                      />
                      <input v-model="entry.condition" class="text_pole" :placeholder="t`如:战斗场景、关系亲密时`" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="choice-empty-hint">
            <i class="fa-solid fa-database"></i>
            <span>{{ t`条目库为空，点击 + 添加或使用 AI 生成` }}</span>
          </div>
        </div>

        <div v-if="selected.size > 0" class="choice-epool-batch-bar">
          <span class="choice-epool-batch-count">{{ t`已选 ${selected.size} 条` }}</span>
          <button class="choice-btn-sm" :title="t`复制选中的条目`" @click="copySelected">
            <i class="fa-solid fa-copy"></i> {{ t`复制` }}
          </button>
          <button class="choice-btn-sm" :title="t`移动到分组`" @click="moveSelected = !moveSelected">
            <i class="fa-solid fa-arrow-right"></i> {{ t`移动` }}
          </button>
          <select v-if="moveSelected" v-model="moveTargetCat" class="text_pole choice-cat-select" @click.stop>
            <option value="">{{ t`未分组` }}</option>
            <option v-for="cat in categoryNames" :key="cat" :value="cat">{{ cat }}</option>
          </select>
          <button v-if="moveSelected" class="choice-btn-sm" :title="t`确认移动到目标分组`" @click="moveSelectedEntries">
            {{ t`确认移动` }}
          </button>
          <button
            class="choice-btn-sm choice-btn-del"
            :title="t`删除选中的条目`"
            @click="deleteTarget = { type: 'batch', count: selected.size }"
          >
            <i class="fa-solid fa-trash-can"></i> {{ t`删除` }}
          </button>
          <button
            class="choice-btn-sm"
            :title="t`取消选择`"
            @click="
              selected.clear();
              deleteTarget = null;
            "
          >
            {{ t`取消` }}
          </button>
        </div>

        <PoolGenDialog :open="showGen" :categories="categoryNames" @close="showGen = false" @confirm="onGenConfirm" />

        <ImportPoolDialog
          :open="showImportPool"
          :data="importFileData"
          @close="showImportPool = false"
          @confirm="onImportPoolConfirm"
        />

        <input type="file" accept=".json" ref="fileInput" style="display: none" @change="onFileSelected" />

        <ConfirmDialog
          :open="deleteTarget !== null"
          :title="deleteDialogTitle"
          :message="deleteDialogMessage"
          :confirm-text="t`删除`"
          :cancel-text="t`取消`"
          @confirm="onDeleteConfirm"
          @cancel="deleteTarget = null"
        />

        <GuidePopover
          :visible="showGuide"
          :anchor-el="guideBtn"
          icon="fa-solid fa-database"
          title="条目库是什么"
          @close="showGuide = false"
        >
          <div v-html="guideHtml"></div>
        </GuidePopover>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { uuidv4 } from '@sillytavern/scripts/utils';
import PoolGenDialog from '@/components/PoolGenDialog.vue';
import ImportPoolDialog from '@/components/ImportPoolDialog.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import GuidePopover from '@/components/GuidePopover.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { PoolEntry } from '@/type/settings';
import { draggableFilterOptions } from '@/util/sortable';
import Sortable from 'sortablejs';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const globalStore = useGlobalSettingsStore();
const masterPool = computed(() => globalStore.settings.master_pool);
const configs = computed(() => globalStore.settings.configs);

const expanded = ref<Set<string>>(new Set());
const expandedGroups = ref<Set<string>>(new Set());
const allGroupsExpanded = ref(false);
const groupRenameId = ref<string | null>(null);
const groupRenameText = ref('');
const showGen = ref(false);
const showImportPool = ref(false);
const importFileData = ref<any>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const guideHtml = `<p><strong>条目库</strong> 是所有行动选项条目的总仓库，按分组管理。配置中的条目都是从这里勾选引用的，修改条目库会同步影响所有使用该条目的配置。</p>
<p><strong>分组</strong>：点击分组名可展开/折叠，支持跨分组拖拽条目。空分组在关闭弹窗时会自动清理。点击分组名旁的 + 添加条目，📋 复制整组。</p>
<p><strong>操作</strong>：左侧勾选复选框批量选中，顶部工具栏支持全部展开/收起、新建分组、文件导入/导出、AI 批量生成。拖拽 ☰ 可调整条目顺序。</p>`;
const deleteTarget = ref<
  | { type: 'entry'; id: string; summary: string }
  | { type: 'group'; key: string; count: number }
  | { type: 'batch'; count: number }
  | null
>(null);
const selected = ref<Set<string>>(new Set());
const moveSelected = ref(false);
const moveTargetCat = ref('');
const pendingGroups = computed({
  get: () => new Set(globalStore.settings.empty_groups),
  set: val => {
    globalStore.settings.empty_groups = [...val];
  },
});

const addPendingGroup = (key: string) => {
  if (!globalStore.settings.empty_groups.includes(key)) {
    globalStore.settings.empty_groups = [...globalStore.settings.empty_groups, key];
  }
};
const removePendingGroup = (key: string) => {
  globalStore.settings.empty_groups = globalStore.settings.empty_groups.filter(k => k !== key);
};
const hasPendingGroup = (key: string): boolean => {
  return globalStore.settings.empty_groups.includes(key);
};

watch(
  () => props.open,
  val => {
    if (!val) {
      deleteTarget.value = null;
      selected.value = new Set();
      moveSelected.value = false;
      groupRenameId.value = null;
    }
  },
);

const categoryNames = computed(() => {
  const names = new Set<string>();
  for (const e of masterPool.value) {
    if (e.category.trim()) names.add(e.category.trim());
  }
  for (const name of pendingGroups.value) {
    names.add(name);
  }
  return [...names].sort();
});

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
  for (const name of pendingGroups.value) {
    if (!map.has(name)) {
      map.set(name, []);
    }
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
  if (!entry.content.trim()) return type.slice(0, 50);
  return type.replace(/"/g, '') + ' | ' + entry.content.replace(/"/g, '').slice(0, 40);
};

const toggleEntry = (id: string) => {
  deleteTarget.value = null;
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
};

const toggleGroup = (key: string) => {
  deleteTarget.value = null;
  if (expandedGroups.value.has(key)) expandedGroups.value.delete(key);
  else expandedGroups.value.add(key);
};

const onEntryCategoryChange = (entry: PoolEntry, newCat: string) => {
  const oldCat = entry.category.trim() || '';
  entry.category = newCat;
  if (oldCat && oldCat !== newCat) {
    if (hasPendingGroup(newCat)) removePendingGroup(newCat);
    const fromEntries = masterPool.value.filter(e => (e.category.trim() || '') === oldCat);
    if (fromEntries.length === 0) addPendingGroup(oldCat);
  }
};

const toggleExpandAllGroups = () => {
  deleteTarget.value = null;
  if (allGroupsExpanded.value) {
    expandedGroups.value = new Set();
    allGroupsExpanded.value = false;
  } else {
    const allKeys = new Set(groupedEntries.value.map(g => g.key));
    for (const name of pendingGroups.value) allKeys.add(name);
    expandedGroups.value = allKeys;
    allGroupsExpanded.value = true;
  }
};

const copyGroup = (group: EntryGroup) => {
  deleteTarget.value = null;
  const texts = group.entries
    .map(e => (e.content.trim() ? `${e.type}: ${e.content}` : e.type))
    .filter(t => t.trim())
    .join('\n');
  if (!texts) {
    toastr.warning(t`没有可复制的内容`);
    return;
  }
  navigator.clipboard
    .writeText(texts)
    .then(() => {
      toastr.success(t`已复制 ${group.entries.length} 条到剪贴板`);
    })
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = texts;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toastr.success(t`已复制 ${group.entries.length} 条到剪贴板`);
      } catch {
        toastr.error(t`复制失败`);
      }
      document.body.removeChild(ta);
    });
};

const toggleSelectEntry = (id: string) => {
  deleteTarget.value = null;
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
};

const isGroupAllSelected = (group: EntryGroup) =>
  group.entries.length > 0 && group.entries.every(e => selected.value.has(e.id));

const toggleSelectGroup = (group: EntryGroup) => {
  deleteTarget.value = null;
  if (isGroupAllSelected(group)) {
    for (const e of group.entries) selected.value.delete(e.id);
  } else {
    for (const e of group.entries) selected.value.add(e.id);
  }
};

const copySelected = () => {
  const texts = masterPool.value
    .filter(e => selected.value.has(e.id))
    .map(e => (e.content.trim() ? `${e.type}: ${e.content}` : e.type))
    .filter(t => t.trim())
    .join('\n');
  if (!texts) {
    toastr.warning(t`没有可复制的内容`);
    return;
  }
  navigator.clipboard
    .writeText(texts)
    .then(() => {
      toastr.success(t`已复制到剪贴板`);
    })
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = texts;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toastr.success(t`已复制到剪贴板`);
      } catch {
        toastr.error(t`复制失败`);
      }
      document.body.removeChild(ta);
    });
};

const moveSelectedEntries = () => {
  const target = moveTargetCat.value;
  const sourceCats = new Set<string>();
  for (const e of masterPool.value) {
    if (selected.value.has(e.id)) {
      sourceCats.add(e.category.trim() || '');
      e.category = target;
    }
  }
  for (const cat of sourceCats) {
    if (cat !== target && !masterPool.value.some(e => (e.category.trim() || '') === cat)) {
      addPendingGroup(cat);
    }
  }
  selected.value = new Set();
  moveSelected.value = false;
  moveTargetCat.value = '';
  expandedGroups.value.add(target);
};

const deleteSelected = () => {
  const ids = new Set(selected.value);
  for (let i = masterPool.value.length - 1; i >= 0; i--) {
    if (ids.has(masterPool.value[i].id)) {
      masterPool.value.splice(i, 1);
    }
  }
  for (const id of ids) {
    expanded.value.delete(id);
  }
  selected.value = new Set();
  deleteTarget.value = null;
  for (const cfg of configs.value) {
    for (let i = cfg.entries.length - 1; i >= 0; i--) {
      if (ids.has(cfg.entries[i].entry_id)) {
        cfg.entries.splice(i, 1);
      }
    }
  }
};

const createGroup = () => {
  deleteTarget.value = null;
  const name = prompt(t`请输入分组名称`);
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (categoryNames.value.includes(trimmed)) {
    toastr.warning(t`分组「${trimmed}」已存在`);
    return;
  }
  addPendingGroup(trimmed);
  expandedGroups.value.add(trimmed);
  allGroupsExpanded.value = false;
};

const startGroupRename = (groupKey: string) => {
  groupRenameId.value = groupKey;
  groupRenameText.value = groupKey;
};

const finishGroupRename = (oldKey: string) => {
  const newName = groupRenameText.value.trim();
  if (!newName || newName === oldKey) {
    groupRenameId.value = null;
    return;
  }
  if (newName !== oldKey && categoryNames.value.includes(newName) && newName !== groupRenameId.value) {
    toastr.warning(t`分组「${newName}」已存在`);
    groupRenameId.value = null;
    return;
  }
  for (const entry of masterPool.value) {
    if ((entry.category.trim() || '') === oldKey) {
      entry.category = newName;
    }
  }
  const orderIdx = globalStore.settings.group_order.indexOf(oldKey);
  if (orderIdx !== -1) globalStore.settings.group_order[orderIdx] = newName;
  if (hasPendingGroup(oldKey)) {
    removePendingGroup(oldKey);
    addPendingGroup(newName);
  }
  groupRenameId.value = null;
};

const cancelGroupRename = () => {
  groupRenameId.value = null;
};

const addEntryToGroup = (groupKey: string) => {
  deleteTarget.value = null;
  const entry: PoolEntry = {
    id: uuidv4(),
    type: '',
    content: '',
    rule: '',
    pinned: false,
    weight: 1,
    category: groupKey,
    condition: '',
  };
  masterPool.value.push(entry);
  expanded.value.add(entry.id);
  expandedGroups.value.add(groupKey);
  if (hasPendingGroup(groupKey)) {
    removePendingGroup(groupKey);
  }
};

const removeEntry = (id: string) => {
  const idx = masterPool.value.findIndex(e => e.id === id);
  if (idx !== -1) masterPool.value.splice(idx, 1);
  expanded.value.delete(id);
  deleteTarget.value = null;
  for (const cfg of configs.value) {
    const eidx = cfg.entries.findIndex(e => e.entry_id === id);
    if (eidx !== -1) cfg.entries.splice(eidx, 1);
  }
};

const removeGroup = (group: EntryGroup) => {
  const ids = new Set(group.entries.map(e => e.id));
  for (let i = masterPool.value.length - 1; i >= 0; i--) {
    if (ids.has(masterPool.value[i].id)) {
      masterPool.value.splice(i, 1);
    }
  }
  for (const id of ids) {
    expanded.value.delete(id);
  }
  expandedGroups.value.delete(group.key);
  removePendingGroup(group.key);
  deleteTarget.value = null;
  for (const cfg of configs.value) {
    for (let i = cfg.entries.length - 1; i >= 0; i--) {
      if (ids.has(cfg.entries[i].entry_id)) {
        cfg.entries.splice(i, 1);
      }
    }
  }
};

const onGenConfirm = ({
  additions,
  replacements,
}: {
  additions: PoolEntry[];
  replacements: { id: string; type: string; content: string }[];
}) => {
  for (const r of replacements) {
    const target = masterPool.value.find(e => e.id === r.id);
    if (target) {
      target.type = r.type;
      target.content = r.content;
    }
  }
  if (additions.length) masterPool.value.push(...additions);
  showGen.value = false;
};

const onExportPool = () => {
  const json = JSON.stringify(
    {
      version: 1,
      type: 'choice-pool-export',
      exportedAt: new Date().toISOString(),
      data: {
        master_pool: globalStore.settings.master_pool,
        configs: globalStore.settings.configs,
        group_order: globalStore.settings.group_order,
      },
    },
    null,
    2,
  );
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `choice-pool-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const onImportFile = () => fileInput.value?.click();

const onFileSelected = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data?.type !== 'choice-pool-export') {
      toastr.error(t`文件格式不正确`);
      return;
    }
    importFileData.value = { ...data.data, fileName: file.name, exportedAt: data.exportedAt };
    showImportPool.value = true;
  } catch {
    toastr.error(t`文件解析失败`);
  }
  (e.target as HTMLInputElement).value = '';
};

const onImportPoolConfirm = (mode: 'merge' | 'replace') => {
  if (!importFileData.value) return;
  const { master_pool, configs, group_order } = importFileData.value;
  if (mode === 'replace') {
    globalStore.settings.master_pool = master_pool ?? [];
    globalStore.settings.configs = configs ?? [];
    globalStore.settings.group_order = group_order ?? [];
  } else {
    if (master_pool?.length) globalStore.settings.master_pool.push(...master_pool);
    if (configs?.length) {
      for (const cfg of configs) {
        if (!globalStore.settings.configs.some(c => c.name === cfg.name)) {
          globalStore.settings.configs.push(cfg);
        }
      }
    }
    if (group_order?.length) {
      for (const g of group_order) {
        if (!globalStore.settings.group_order.includes(g)) {
          globalStore.settings.group_order.push(g);
        }
      }
    }
  }
  showImportPool.value = false;
  importFileData.value = null;
  toastr.success(mode === 'replace' ? t`条目库已替换` : t`条目库已合并`);
};

const deleteDialogTitle = computed(() => {
  if (!deleteTarget.value) return '';
  switch (deleteTarget.value.type) {
    case 'entry':
      return t`删除条目`;
    case 'group':
      return t`删除分组`;
    case 'batch':
      return t`批量删除`;
  }
});

const deleteDialogMessage = computed(() => {
  if (!deleteTarget.value) return '';
  switch (deleteTarget.value.type) {
    case 'entry':
      return t`确定要删除条目「${deleteTarget.value.summary}」吗？此操作不可撤销。`;
    case 'group':
      return t`确定要删除分组「${deleteTarget.value.key || t`未分组`}」及其全部 ${deleteTarget.value.count} 条条目吗？此操作不可撤销。`;
    case 'batch':
      return t`确定要删除选中的 ${deleteTarget.value.count} 条条目吗？此操作不可撤销。`;
  }
});

const onDeleteConfirm = () => {
  if (!deleteTarget.value) return;
  switch (deleteTarget.value.type) {
    case 'entry': {
      removeEntry(deleteTarget.value.id);
      break;
    }
    case 'group': {
      const target = deleteTarget.value;
      if (!target || target.type !== 'group') break;
      const group = groupedEntries.value.find(g => g.key === target.key);
      if (group) removeGroup(group);
      break;
    }
    case 'batch': {
      deleteSelected();
      break;
    }
  }
};

const groupList = ref<HTMLElement | null>(null);
let groupSortable: Sortable | null = null;
const entrySortables = new Map<string, Sortable>();

const initGroupSortable = () => {
  if (!groupList.value) return;
  if (groupSortable) groupSortable.destroy();
  groupSortable = Sortable.create(groupList.value, {
    ...draggableFilterOptions,
    draggable: '.choice-epool-group',
    animation: 150,
    delay: 100,
    onEnd: evt => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
      const keys = groupedEntries.value.map(g => g.key);
      const [moved] = keys.splice(evt.oldIndex, 1);
      keys.splice(evt.newIndex, 0, moved);
      globalStore.settings.group_order = keys;
    },
  });
};

const initEntrySortables = () => {
  for (const [, s] of entrySortables) s.destroy();
  entrySortables.clear();
  const bodies = document.querySelectorAll('.choice-epool-group-body');
  bodies.forEach(body => {
    const groupKey = (body as HTMLElement).dataset.groupKey || '';
    const s = Sortable.create(body as HTMLElement, {
      ...draggableFilterOptions,
      group: 'entries',
      draggable: '.choice-epool-entry',
      delay: 100,
      animation: 150,
      onEnd: evt => {
        const entryId = evt.item.dataset.entryId;
        if (!entryId) return;
        const fromKey = evt.from.dataset.groupKey || '';
        const toKey = (evt.to as HTMLElement).dataset.groupKey || '';
        if (toKey) expandedGroups.value.add(toKey);
        const entry = masterPool.value.find(e => e.id === entryId);
        if (!entry) return;
        if (fromKey !== toKey) {
          entry.category = toKey;
          if (hasPendingGroup(toKey)) removePendingGroup(toKey);
          const fromEntries = masterPool.value.filter(e => (e.category.trim() || '') === fromKey);
          if (fromEntries.length === 0) {
            addPendingGroup(fromKey);
          }
        }
        const oldIdx = masterPool.value.indexOf(entry);
        if (oldIdx !== -1) masterPool.value.splice(oldIdx, 1);
        const toEntries = masterPool.value.filter(e => (e.category.trim() || '') === toKey);
        if (evt.newIndex !== undefined && evt.newIndex < toEntries.length) {
          const ref = toEntries[evt.newIndex];
          const refIdx = masterPool.value.indexOf(ref);
          masterPool.value.splice(refIdx, 0, entry);
        } else {
          masterPool.value.push(entry);
        }
        if (!masterPool.value.includes(entry)) {
          console.warn('[Choice] 条目拖拽后丢失，重新加入', entryId);
          masterPool.value.push(entry);
        }
      },
    });
    entrySortables.set(groupKey, s);
  });
};

onMounted(() => {
  watch(
    [groupList, () => groupedEntries.value.length],
    () => {
      nextTick(() => {
        initGroupSortable();
        initEntrySortables();
      });
    },
    { immediate: true },
  );
});

onUnmounted(() => {
  if (groupSortable) groupSortable.destroy();
  for (const s of entrySortables.values()) s.destroy();
});
</script>

<style scoped>
.choice-epool-overlay {
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

.choice-epool-dialog {
  width: 600px;
  max-width: 92vw;
  max-height: 85vh;
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

.choice-epool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-3);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-epool-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-epool-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  font-weight: normal;
}

.choice-epool-header-actions {
  display: inline-flex;
  gap: var(--choice-space-1);
  align-items: center;
}

.choice-epool-close {
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

.choice-epool-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-epool-body {
  overflow-y: auto;
  padding: var(--choice-space-3);
  flex: 1;
}

.choice-epool-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
}

/* 分组 */
.choice-epool-group {
  display: flex;
  flex-direction: column;
}

.choice-epool-group-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  cursor: pointer;
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  border: 1px solid var(--choice-border);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  flex-wrap: wrap;
}

.choice-epool-group-head:hover {
  background: var(--choice-bg-hover);
}

.choice-epool-group-name {
  font-weight: bold;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-epool-group-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  cursor: pointer;
}

.choice-epool-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) 0 var(--choice-space-1) var(--choice-space-4);
  max-height: 2000px;
  overflow: hidden;
  transition:
    max-height var(--choice-transition-slow),
    opacity var(--choice-transition-slow),
    padding var(--choice-transition-slow);
  opacity: 1;
}

.choice-epool-group-body.is-collapsed {
  max-height: 4px;
  padding: 0;
  opacity: 0;
}

/* 条目 */
.choice-epool-entry {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  overflow: hidden;
}

.choice-epool-entry-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-1) var(--choice-space-2);
  min-height: 0;
  flex-wrap: wrap;
}

.choice-epool-entry-head:hover {
  background: var(--choice-bg-hover);
}

.choice-epool-entry-summary {
  flex: 1;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  cursor: pointer;
}

.choice-pin-badge {
  font-size: var(--choice-text-xs);
  flex-shrink: 0;
}

.choice-cat-select {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-1);
  width: auto;
  min-width: 0;
  max-width: 90px;
  flex-shrink: 1;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-cat-select:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-epool-entry-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: 0 var(--choice-space-2) var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding-top: var(--choice-space-2);
}

.choice-epool-entry-fields {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: nowrap;
}

.choice-small-input {
  width: 56px;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-small-input:focus {
  border-color: var(--choice-border-active);
  outline: none;
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

.choice-delete-btn {
  color: var(--choice-color-error);
}

.choice-delete-btn:hover:not(:disabled) {
  color: var(--choice-color-error);
}

.choice-confirm-btn {
  color: var(--choice-color-error);
  background: rgba(200, 106, 106, 0.15);
}

.choice-confirm-btn:hover {
  background: rgba(200, 106, 106, 0.3);
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: nowrap;
}

.choice-empty-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-5) 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-empty-hint i {
  font-size: var(--choice-text-xl);
}

/* 批量操作栏 */
.choice-epool-batch-bar {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  border-top: 1px solid var(--choice-border);
  background: rgba(var(--choice-primary-rgb), 0.06);
  flex-shrink: 0;
}

.choice-epool-batch-count {
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  font-weight: bold;
  margin-right: var(--choice-space-2);
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

.choice-btn-del {
  color: var(--choice-color-error);
}

.choice-btn-del:hover:not(:disabled) {
  color: var(--choice-color-error);
}

.choice-confirm-btn {
  color: var(--choice-color-error) !important;
  background: rgba(200, 106, 106, 0.15) !important;
  border-color: rgba(200, 106, 106, 0.3) !important;
}
</style>
