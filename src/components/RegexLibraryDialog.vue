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
            <button class="choice-icon-btn" :title="t`导入文件`" @click="showImportSource = true">
              <i class="fa-solid fa-file-import"></i>
            </button>
            <button class="choice-icon-btn" :title="exportTitle" @click="onExport">
              <i class="fa-solid fa-file-export"></i>
            </button>
            <span class="choice-regexlib-header-divider"></span>
            <button class="choice-icon-btn" :title="t`从酒馆正则导入`" @click="showStImport = true">
              <i class="fa-solid fa-cloud-arrow-down"></i>
            </button>
            <button ref="guideBtn" class="choice-icon-btn" :title="t`页面指引`" @click="showGuide = !showGuide">
              <i class="fa-solid fa-circle-question"></i>
            </button>
            <button class="choice-regexlib-close" :title="t`关闭`" @click="emit('close')">&times;</button>
          </div>
        </div>

        <div ref="listBody" class="choice-regexlib-body choice-scrollbar">
          <div v-if="groupedEntries.length > 0" ref="groupListEl" class="choice-regexlib-list">
            <div v-for="group in groupedEntries" :key="group.key" class="choice-regexlib-group">
              <div class="choice-regexlib-group-head" @click="toggleGroup(group.key)">
                <DragHandle class="choice-drag-handle--group" :title="t`拖动排序`" @click.stop />
                <!-- 勾选列始终显示：普通视图下勾选分组/条目即可部分导出（selectable 模式另作过滤配置勾选） -->
                <label class="choice-check" @click.stop>
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
                  <DragHandle :title="t`拖动排序/换组`" />
                  <label class="choice-check">
                    <input type="checkbox" :checked="selectedIds.has(entry.id)" @change="toggleSelect(entry.id)" />
                  </label>
                  <!-- 类型选择宽度收进 class：内联 style 优先级高于任何媒体查询，
                       手机上 90px 固定宽会把正则输入挤到不可操作 -->
                  <select v-model="entry.type" class="text_pole choice-regexlib-type">
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

  <!-- 导入源对话框：粘贴/选文件 → 解析并合并直接落库（正则库只有合并语义，无替换） -->
  <ImportSourceDialog
    :open="open && showImportSource"
    :title="t`导入正则库`"
    :error="importSourceError"
    @close="showImportSource = false"
    @merge="onImportSource"
  />

  <GuidePopover
    :visible="open && showGuide"
    :anchor-el="guideBtn"
    icon="fa-solid fa-code"
    title="正则库是什么"
    @close="showGuide = false"
  >
    <div v-html="guideHtml"></div>
  </GuidePopover>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { useGlobalSettingsStore } from '@/store/global-settings';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import DragHandle from '@/components/shared/DragHandle.vue';
import GuidePopover from '@/components/GuidePopover.vue';
import ImportSourceDialog from '@/components/shared/ImportSourceDialog.vue';
import type { RegexLibraryEntry } from '@/type/settings';
import { mapStScriptToLibraryEntry } from '@/core/st-regex-source';
import StRegexImportDialog from '@/components/StRegexImportDialog.vue';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { DRAG_HANDLE_GROUP_SELECTOR, DRAG_HANDLE_SELECTOR, draggableFilterOptions } from '@/util/sortable';
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

const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const guideHtml = `<p><strong>正则库</strong> 是所有正则脚本的统一存放处，按分组管理；脚本本体通过「正则」设置页生效，这里负责集中管理与跨配置复用。</p>
<p><strong>分组</strong>：点击分组名展开/折叠，拖拽左侧把手可排序分组或把条目拖入其他分组。点击分组名旁的 + 添加条目。</p>
<p><strong>操作</strong>：顶部工具栏支持全部展开/收起、新建分组、文件导入/导出；「从酒馆正则导入」可从酒馆全局/预设/角色卡三区勾选导入。左侧勾选复选框批量选中后，由过滤配置引用。</p>`;

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
  const cat = name?.trim();
  if (!cat) return;
  const groups = gs.settings.filter_settings.library_groups ?? [];
  // 重名检测：同名分组会让条目归类歧义，提醒后放弃创建
  if (groups.includes(cat)) {
    toastr.warning(t`分组「${cat}」已存在`);
    return;
  }
  groups.push(cat);
  expandedGroups.value.add(cat);
};

const addEntryToGroup = (category: string) => {
  gs.addRegexLibraryEntry(category);
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
    // 重名检测：与其他分组同名会让条目归类歧义，提醒后放弃修改
    if ((gs.settings.filter_settings.library_groups ?? []).includes(newKey)) {
      toastr.warning(t`分组「${newKey}」已存在`);
    } else {
      gs.renameRegexLibraryGroup(oldKey, newKey);
    }
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

// 部分导出：勾选了分组/条目即仅导出勾选的正则（条目自带 category 字段，分组归属随条目走）；
// 无勾选则全量导出。按钮 title 随勾选数动态提示
const exportTitle = computed(() =>
  selectedIds.value.size > 0 ? t`导出文件（仅导出选中的 ${selectedIds.value.size} 条）` : t`导出文件`,
);

const onExport = () => {
  const partial = selectedIds.value.size > 0;
  const entries = partial ? library.value.filter(e => selectedIds.value.has(e.id)) : library.value;
  // 空库/空勾选防护：空文件导回去再导入会"成功"却什么都不加（死亡循环），直接阻止
  if (entries.length === 0) {
    toastr.warning(t`没有可导出的正则（库为空或未勾选任何条目）`);
    return;
  }
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), partial, entries }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `choice-regex-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toastr.success(partial ? t`已导出选中的 ${entries.length} 条正则` : t`已导出全部 ${entries.length} 条正则`);
};

// 导入入口改为 ImportSourceDialog（文件/粘贴双路径）：粘贴不经过文件选择器，
// 是选择器受限环境（套壳/旧 WebView）下的兜底可用路径。
// 失败保持源弹窗打开并在框内红字显示原因：粘贴内容不丢失，用户可直接修改后重试
const showImportSource = ref(false);
const importSourceError = ref('');

const onImportSource = ({ text }: { text: string; fileName: string }) => {
  importSourceError.value = '';
  let data: any;
  try {
    // 去 BOM 与首尾杂质
    const clean = text.replace(/^\uFEFF/, '').trim();
    data = JSON.parse(clean);
  } catch (err: any) {
    importSourceError.value = t`JSON 解析失败：${err?.message ?? err}。请确认粘贴的是导出文件的完整内容（从 { 到 }）`;
    return;
  }
  try {
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
        showImportSource.value = false;
        return;
      }
      throw new Error('未识别到可导入的正则条目');
    }
    fs.regex_library.push(...imported);
    const parts = [t`已导入 ${imported.length} 条正则`];
    if (duplicated > 0) parts.push(t`去重 ${duplicated} 条重复项`);
    if (invalid > 0) parts.push(t`跳过 ${invalid} 条无效项`);
    toastr.success(parts.join('，'));
    showImportSource.value = false; // 落库成功才关源弹窗
  } catch (err) {
    // 失败保持源弹窗打开：粘贴内容不丢失，红字显示具体原因供用户处理
    importSourceError.value = t`导入失败：${err instanceof Error ? err.message : '无效文件'}`;
  }
};

watch(
  () => props.open,
  isOpen => {
    if (isOpen) {
      // selectable 模式（过滤配置勾选）预勾选已被引用的正则；普通视图从空选开始
      selectedIds.value = new Set(props.selectable ? props.alreadyReferencedIds : []);
      // 分组默认折叠，与条目库一致（此前每次打开都强制全展开，与条目库行为割裂）；
      // 拖拽悬停自动展开（onDragHoverExpand）不受影响，折叠分组仍可作为投放目标
      expandedGroups.value = new Set();
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
          // 触屏防误触由共享配置的 delay/delayOnTouchOnly/touchStartThreshold 兜底：
          // 按住把手 120ms 且几乎不动才进入拖拽，碰到把手立即滑动交给原生滚动
          handle: DRAG_HANDLE_SELECTOR,
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
        handle: DRAG_HANDLE_GROUP_SELECTOR,
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
  /* 同 dvh 回退：手机上按可视高度取值，弹窗底部不再被系统栏顶出屏幕外 */
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-floating);
  background: var(--choice-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}
.choice-regexlib-dialog {
  width: 600px;
  max-width: 92vw;
  /* 同 dvh 回退 */
  max-height: 85vh;
  max-height: 85dvh;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  /* 磨砂高光与条目库弹窗一致（此前缺 inset 高光导致两库观感不同） */
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.choice-regexlib-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  row-gap: var(--choice-space-1);
  flex-wrap: wrap;
  padding: var(--choice-space-2) var(--choice-space-3);
  /* 主色渐变头部与条目库统一（此前是纯灰底，观感像两套主题） */
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}
.choice-regexlib-header-divider {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--choice-border-strong);
  flex-shrink: 0;
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
/* 头部按钮尺寸显式约定 28px：scoped 尺寸必须一致，否则出现"有的 40 有的 28"
   导致头部一行放不下（此前正则库 40px、条目库 28px 就是混战的结果）。
   28px 是条目库头部既有尺寸，两库统一 */
.choice-regexlib-header .choice-icon-btn {
  width: 28px;
  height: 28px;
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

/* 窄屏（手机）：头部横向内边距收窄 + 隐藏头部总计数，保证 8 个元素单行放下。
   分组计数此前在此隐藏，用户要求可见——已移除该规则，分组头计数改由
   flex-shrink:0 + nowrap 防挤压（见下方 group-count 与文件尾紧凑媒体块） */
@media (pointer: coarse) and (max-width: 480px) {
  .choice-regexlib-header {
    padding-inline: var(--choice-space-2);
  }
  .choice-regexlib-count {
    display: none;
  }
}

/* 窄屏（手机）下弹窗近全屏：与 shared/ChoiceDialog 的窄屏规则一致，
   行密度收紧后一屏能看到更多行（max-width 不同步放宽会被基础 92vw 钳住） */
@media (max-width: 480px) {
  .choice-regexlib-dialog {
    width: 96vw;
    max-width: 96vw;
    /* 同 dvh 回退 */
    max-height: 92vh;
    max-height: 92dvh;
  }
}
.choice-regexlib-body {
  flex: 1;
  overflow-y: auto;
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
  padding: var(--choice-space-2);
}
.choice-regexlib-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}
/* 分组结构与条目库对齐：分组头是独立描边卡片、条目各自成卡、容器本身无描边——
   此前容器整体描边在折叠时于分组头下描出一圈 4px 细框（用户看到的"黑框"），
   两库观感也割裂 */
.choice-regexlib-group {
  display: flex;
  flex-direction: column;
}
.choice-regexlib-group-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-1) var(--choice-space-2);
  background: var(--choice-bg-card);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  cursor: pointer;
  font-size: var(--choice-text-sm);
  user-select: none;
}
.choice-regexlib-group-head:hover {
  background: rgba(128, 128, 128, 0.05);
}
.choice-regexlib-group-name {
  flex: 1;
  font-weight: bold;
  color: var(--choice-text-secondary);
  /* 对齐条目库：缺 min-width:0 时长分组名会把计数挤到 0 宽（"计数消失"的真因） */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-regexlib-group-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  flex-shrink: 0;
  white-space: nowrap;
}
/* 折叠用 max-height 而非 display:none：body 仍占 4px 高度留在布局中，
   SortableJS 才能把它识别为 drop target（拖入折叠分组后 onEnd 自动展开）。
   body 无描边、折叠时 padding 清零——配合无描边容器，折叠后头下不再出现细框。
   上限 2000→20000px 且子行 flex-shrink:0：flex 列容器在限高下会把行按比例压扁
   成细条（flex 默认 shrink），正则多时全部叠在一起不可操作；行高恒定后超出部分
   由外层 .choice-regexlib-body 滚动呈现。20000px ≈ 数百行，实际不会触达裁剪 */
.choice-regexlib-group-body {
  padding: var(--choice-space-1) 0 var(--choice-space-1) var(--choice-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  max-height: 20000px;
  overflow: hidden;
  opacity: 1;
  transition:
    max-height var(--choice-transition-slow, 0.2s ease),
    opacity var(--choice-transition-slow, 0.2s ease),
    padding var(--choice-transition-slow, 0.2s ease);
}
.choice-regexlib-group-body > * {
  flex-shrink: 0;
}
.choice-regexlib-group-body.is-collapsed {
  max-height: 4px;
  padding: 0;
  opacity: 0;
}

/* 类型选择：桌面 90px；窄屏由媒体查询收到 64px（原为内联 style，媒体查询压不过）。
   min-width 必须清零——ST 的 .text_pole 自带 min-width，会把 64px 顶回 90px。
   注意：这两条基础规则必须排在下方紧凑媒体块之前——同特异性时靠源码顺序取胜，
   放到媒体块之后会让 90/110px 在手机上压不下去（修复时踩过：被静默覆盖） */
.choice-regexlib-type {
  width: 90px;
  min-width: 0;
  flex-shrink: 0;
}
/* 替换为：导入 ST 正则时承载 replaceString（如 $1 保留内容只去标签壳），留空 = 整段删除 */
.choice-regexlib-replace {
  width: 110px;
  flex-shrink: 0;
}

/* 手机窄屏（<480px 触屏）：紧凑单行——把手/按钮 24px、间距收 4px、缩进收窄；
   类型选择/替换输入收窄（56px 明显小于正则框），行宽优先让给正则输入——
   "正则表达式"是主字段、"替换为"是次要字段，宽度层级必须反映主次。
   原固定宽 90/110px 在 ~350px 行宽下正则输入只剩 ~40px，挤压到无法操作 */
@media (pointer: coarse) and (max-width: 480px) {
  .choice-regexlib-group-head {
    gap: var(--choice-space-1);
  }
  .choice-regexlib-group-head .choice-icon-btn {
    width: 24px;
    height: 24px;
  }
  .choice-regexlib-group-head .choice-drag-handle--group {
    width: 24px;
  }
  .choice-regexlib-group-body {
    padding-left: var(--choice-space-2);
  }
  .choice-regexlib-entry {
    gap: var(--choice-space-1);
    padding: 2px;
  }
  .choice-regexlib-entry .choice-drag-handle {
    width: 24px;
  }
  .choice-regexlib-entry .choice-icon-btn {
    width: 24px;
    height: 24px;
  }
  .choice-regexlib-type {
    width: 64px;
    min-width: 0;
    flex-shrink: 0;
  }
  .choice-regexlib-replace {
    width: 56px;
    flex-shrink: 1;
    min-width: 0;
  }
}
/* 条目行：单行布局，输入控件直接可见，从左侧把手拖拽（把手样式统一由 shared/DragHandle.vue 提供）。
   条目各自成描边卡片，与条目库的条目卡视觉对齐 */
.choice-regexlib-entry {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  padding: 2px 4px;
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
