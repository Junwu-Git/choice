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
            <button class="choice-icon-btn" :title="t`导入文件`" @click="showImportSource = true">
              <i class="fa-solid fa-file-import"></i>
            </button>
            <button class="choice-icon-btn" :title="exportBtnTitle" @click="onExportPool">
              <i class="fa-solid fa-file-export"></i>
            </button>
            <span class="choice-epool-header-divider"></span>
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
                <DragHandle :title="t`拖动排序`" @click.stop />
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
                    <DragHandle :title="t`拖动排序/换组`" />
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
                    <input v-model="entry.rule" class="text_pole" :placeholder="t`规则(适用时机/写作约束，可选)`" />
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

        <PoolGenDialog :open="showGen" :categories="categoryNames" @close="showGen = false" @confirm="onGenConfirm" />

        <ImportPoolDialog
          :open="showImportPool"
          :data="importFileData"
          :initial-mode="'replace'"
          @close="showImportPool = false"
          @confirm="onImportPoolConfirm"
        />

        <!-- 导入源对话框：粘贴/选文件 → 「解析并合并导入」直接落库（一步到位）；
             「替换整个条目库」走预览确认（危险操作）。失败红字显示在对话框内 -->
        <ImportSourceDialog
          :open="showImportSource"
          :title="t`导入条目库`"
          :error="importSourceError"
          :show-replace="true"
          @close="showImportSource = false"
          @merge="onImportMerge"
          @replace="onImportReplace"
        />

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
import DragHandle from '@/components/shared/DragHandle.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { PoolEntry } from '@/type/settings';
import { DRAG_HANDLE_SELECTOR, draggableFilterOptions } from '@/util/sortable';
import ImportSourceDialog from '@/components/shared/ImportSourceDialog.vue';
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
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const guideHtml = `<p><strong>条目库</strong> 是所有行动选项条目的总仓库，按分组管理。配置中的条目都是从这里勾选引用的，修改条目库会同步影响所有使用该条目的配置。</p>
<p><strong>分组</strong>：点击分组名可展开/折叠，支持跨分组拖拽条目。空分组在关闭弹窗时会自动清理。点击分组名旁的 + 添加条目，📋 复制整组。</p>
<p><strong>操作</strong>：左侧勾选复选框后点「导出文件」可只导出勾选的条目（不勾选则全量导出）。顶部工具栏支持全部展开/收起、新建分组、文件导入/导出、AI 批量生成。拖拽 ☰ 可调整条目顺序。</p>`;
const deleteTarget = ref<
  { type: 'entry'; id: string; summary: string } | { type: 'group'; key: string; count: number } | null
>(null);
const selected = ref<Set<string>>(new Set());
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
  replacements: { id: string; type: string; content: string; rule: string }[];
}) => {
  for (const r of replacements) {
    const target = masterPool.value.find(e => e.id === r.id);
    if (target) {
      target.type = r.type;
      target.content = r.content;
      target.rule = r.rule;
    }
  }
  if (additions.length) masterPool.value.push(...additions);
  showGen.value = false;
};

// 部分导出：勾选模式下仅导出勾选的条目与其所属分组；无勾选则全量导出。
// partial 时 configs 置空并带标记——配置按 entry_id 引用条目，部分条目无法还原完整配置，
// 导入端据此禁用"替换"选项，防止替换导入清空现有配置
const onExportPool = () => {
  const partial = selected.value.size > 0;
  const pool = partial ? masterPool.value.filter(e => selected.value.has(e.id)) : masterPool.value;
  // 空库导出防护：空文件导回去再导入会把库清空却提示"成功"（死亡循环），直接阻止
  if (pool.length === 0) {
    toastr.warning(t`条目库为空，没有可导出的条目`);
    return;
  }
  const groupOrder = partial
    ? globalStore.settings.group_order.filter(g => pool.some(e => (e.category || '') === g))
    : globalStore.settings.group_order;
  const json = JSON.stringify(
    {
      version: 1,
      type: 'choice-pool-export',
      exportedAt: new Date().toISOString(),
      partial,
      data: {
        master_pool: pool,
        configs: partial ? [] : globalStore.settings.configs,
        group_order: groupOrder,
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
  toastr.success(partial ? t`已导出选中的 ${pool.length} 条` : t`已导出全部 ${pool.length} 条`);
};

// 头部"导出文件"按钮 title 随勾选数动态提示部分导出
const exportBtnTitle = computed(() =>
  selected.value.size > 0 ? t`导出文件（仅导出选中的 ${selected.value.size} 条）` : t`导出文件`,
);

// 导入选文件走 pickJsonFile（showOpenFilePicker 优先 + 挂载式 input 回退，
// 见 util/file-picker.ts 顶注——分离/隐藏 input 在真机会被静默拦截）
// 导入入口改为 ImportSourceDialog：
// 「解析并合并导入」直接落库（粘贴后一步到位，条目立刻出现在库里）；
// 「替换整个条目库」走预览确认（危险操作）。
// 解析失败红字显示在对话框内，粘贴内容不丢失
const showImportSource = ref(false);
const importSourceError = ref('');

// 公共解析：去 BOM/首尾杂质 + type 校验，失败时写红字并返回 null
const parseImportText = (text: string): any | null => {
  let data: any;
  try {
    const clean = text.replace(/^\uFEFF/, '').trim();
    data = JSON.parse(clean);
  } catch (err: any) {
    importSourceError.value = t`JSON 解析失败：${err?.message ?? err}。请确认粘贴的是导出文件的完整内容（从 { 到 }）`;
    return null;
  }
  if (data?.type !== 'choice-pool-export') {
    importSourceError.value = t`文件格式不正确：type=${data?.type ?? '无'}，需要 choice-pool-export（条目库导出的文件）。正则库导出的文件不能导入条目库`;
    return null;
  }
  return data;
};

// 合并导入：直接落库，条目立刻出现（按 id 去重，重复文件不会产生重复条目）
const onImportMerge = ({ text }: { text: string; fileName: string }) => {
  importSourceError.value = '';
  const data = parseImportText(text);
  if (!data) return;
  const { master_pool, configs, group_order } = data.data ?? {};
  // 空条目文件防护：空库时期导出的文件导入后"成功"却什么都没有（死亡循环），直接阻止
  if (!master_pool?.length) {
    importSourceError.value = t`该文件不包含任何条目（master_pool 为空），无法导入`;
    return;
  }
  const existingIds = new Set(globalStore.settings.master_pool.map(e => e.id));
  const newEntries = master_pool.filter((e: PoolEntry) => !existingIds.has(e.id));
  if (newEntries.length) globalStore.settings.master_pool.push(...newEntries);
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
  showImportSource.value = false;
  toastr.success(
    newEntries.length
      ? t`已导入 ${newEntries.length} 条${master_pool.length - newEntries.length > 0 ? `（${master_pool.length - newEntries.length} 条已存在，跳过）` : ''}`
      : t`全部 ${master_pool.length} 条均已存在，未重复导入`,
  );
};

// 替换导入：走预览确认弹窗（ImportPoolDialog），由用户最终确认
const onImportReplace = ({ text, fileName }: { text: string; fileName: string }) => {
  importSourceError.value = '';
  const data = parseImportText(text);
  if (!data) return;
  const { master_pool } = data.data ?? {};
  if (!master_pool?.length) {
    importSourceError.value = t`该文件不包含任何条目（master_pool 为空），无法导入`;
    return;
  }
  importFileData.value = { ...data.data, partial: !!data.partial, fileName, exportedAt: data.exportedAt };
  showImportSource.value = false;
  showImportPool.value = true;
};

const onImportPoolConfirm = (mode: 'merge' | 'replace') => {
  if (!importFileData.value) return;
  const { master_pool, configs, group_order } = importFileData.value;
  // 空条目文件防护：空库时期导出的文件、或内容为空的文件，导入只会把库清空/保持为空，
  // 却提示"成功"——这正是"导入成功但条目库还是空的"体验事故的来源。直接取消导入
  if (!master_pool?.length) {
    toastr.warning(t`该文件不包含任何条目，已取消导入。请检查是否选错了导出文件`);
    return;
  }
  // 防御：部分导出没有完整 configs，替换会清空现有配置——UI 已禁用，此处兜底按合并处理
  if (mode === 'replace' && importFileData.value.partial) {
    mode = 'merge';
  }
  if (mode === 'replace') {
    globalStore.settings.master_pool = master_pool ?? [];
    globalStore.settings.configs = configs ?? [];
    globalStore.settings.group_order = group_order ?? [];
  } else {
    // 合并按 id 去重：同一份文件合并两次不再产生重复条目（与正则库合并行为对齐）
    const existingIds = new Set(globalStore.settings.master_pool.map(e => e.id));
    const newEntries = (master_pool ?? []).filter((e: PoolEntry) => !existingIds.has(e.id));
    if (newEntries.length) globalStore.settings.master_pool.push(...newEntries);
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
  }
});

const deleteDialogMessage = computed(() => {
  if (!deleteTarget.value) return '';
  switch (deleteTarget.value.type) {
    case 'entry':
      return t`确定要删除条目「${deleteTarget.value.summary}」吗？此操作不可撤销。`;
    case 'group':
      return t`确定要删除分组「${deleteTarget.value.key || t`未分组`}」及其全部 ${deleteTarget.value.count} 条条目吗？此操作不可撤销。`;
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
    handle: DRAG_HANDLE_SELECTOR,
    animation: 150,
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
      handle: DRAG_HANDLE_SELECTOR,
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
  /* 触屏上拖到边缘禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
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
  /* 纵向 8px 与正则库头部严格同高（两库并排对比时头部高度一致） */
  padding: var(--choice-space-2) var(--choice-space-3);
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

/* 分组分隔线：与正则库头部的分隔线同款，把"文件操作"与"AI 生成"分组 */
.choice-epool-header-divider {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--choice-border-strong);
  flex-shrink: 0;
}

/* 头部按钮尺寸显式约定 28px（与正则库头部一致）。此前 global 40px 触控规则
   与各组件 scoped 尺寸互相打架，两库头部一宽一窄观感割裂；头部工具条统一 28 */
.choice-epool-header .choice-icon-btn {
  width: 28px;
  height: 28px;
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

/* 窄屏（手机）下弹窗近全屏：与 shared/ChoiceDialog 的窄屏规则一致，
   条目多时一屏能看到更多行（max-width 不同步放宽会被基础 92vw 钳住） */
@media (max-width: 480px) {
  .choice-epool-dialog {
    width: 96vw;
    max-width: 96vw;
    max-height: 92vh;
  }
}

.choice-epool-body {
  overflow-y: auto;
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
  padding: var(--choice-space-2);
  flex: 1;
}

.choice-epool-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
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
  padding: var(--choice-space-1) var(--choice-space-2);
  cursor: pointer;
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  border: 1px solid var(--choice-border);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

/* 手机窄屏：分组头单行紧凑——按钮 28px、把手 28px、隐藏计数，
   不换行（此前 flex-wrap 让整排按钮折到分组名下方，看起来像"点击分组跳出菜单"）。
   分组名 flex:1 省略号兜底 */
@media (pointer: coarse) and (max-width: 480px) {
  .choice-epool-group-head .choice-icon-btn {
    width: 28px;
    height: 28px;
  }

  .choice-epool-group-head .choice-drag-handle {
    width: 28px;
  }

  .choice-epool-group-head .choice-epool-group-count {
    display: none;
  }
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
