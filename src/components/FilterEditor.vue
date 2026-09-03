<template>
  <div class="choice-filter-editor">
    <!-- 状态栏 -->
    <div class="choice-config-status">
      <span class="choice-config-status-label">{{ t`当前生效` }}:</span>
      <span class="choice-bound-badge"> <i class="fa-solid fa-globe"></i> {{ t`全局` }} {{ globalActiveCount }} </span>
      <span v-if="gs.currentPresetName" class="choice-bound-badge">
        <i class="fa-solid fa-sliders"></i> {{ gs.currentPresetName }} {{ presetActiveCount }}
      </span>
      <span v-else class="choice-bound-badge choice-bound-fallback">
        <i class="fa-solid fa-sliders"></i> {{ t`预设（无）` }}
      </span>
      <span v-if="currentCharName !== t`未选择`" class="choice-bound-badge choice-bound-char">
        <i class="fa-solid fa-address-card"></i> {{ currentCharName }} {{ charActiveCount }}
      </span>
      <span v-else class="choice-bound-badge choice-bound-fallback">
        <i class="fa-solid fa-address-card"></i> {{ t`角色卡（未选择）` }}
      </span>
    </div>

    <hr class="sysHR" />

    <!-- 标签提取快速区（新手入口）：不理解分区/分组/正则也能用，填标签名即可。
         规则存进固定 id 的专用全局分组（见 global-settings ensureExtractGroup），
         生成时恒定先于下方手动分组的 tag/regex 规则执行（先裁剪后过滤），互不干扰。
         预览行实时演示"填的名字 → 匹配的标签对"，消除"单框到底填什么"的疑惑 -->
    <div class="choice-extract-quick" data-tour="filter-extract-quick">
      <div class="choice-extract-quick-head">
        <span class="choice-inline-label"><i class="fa-solid fa-bolt"></i> {{ t`标签提取` }}</span>
        <span class="choice-extract-quick-desc">{{
          t`新手推荐：只把指定标签对里的内容发给 AI，其余内容全部丢弃`
        }}</span>
        <!-- 提取总开关：关 = 规则保留但全部停用（不受下方任何分组开关影响） -->
        <ChoiceSwitch
          v-model="gs.extractGroupEnabled"
          class="choice-extract-quick-switch"
          :title="gs.extractGroupEnabled ? t`标签提取已启用` : t`标签提取已停用（规则保留）`"
        />
      </div>
      <div class="choice-extract-quick-row">
        <input
          v-model="extractInput"
          class="text_pole choice-extract-input"
          :placeholder="t`只填标签名，如：正文`"
          @keydown.enter="addExtract"
        />
        <button class="choice-btn-sm choice-btn-new" @click="addExtract">
          <i class="fa-solid fa-plus"></i> {{ t`提取该标签` }}
        </button>
      </div>
      <!-- 实时预览：填"正文"就展示 <正文>…</正文>，所见即所提取 -->
      <div class="choice-extract-preview">
        <span v-if="extractPreviewName">
          {{ t`发送时只保留 ${extractPreviewName} 之间的内容（含标签本身），其余全部丢弃：` }}
          <code class="choice-extract-preview-tag">&lt;{{ extractPreviewName }}&gt;…&lt;/{{ extractPreviewName }}&gt;</code>
        </span>
        <span v-else>{{ t`示例：卡里的剧情若包在 &lt;正文&gt;…&lt;/正文&gt; 里，这里就填「正文」` }}</span>
      </div>
      <div
        v-if="gs.extractTagNames.length > 0"
        class="choice-extract-chips"
        :class="{ 'choice-extract-chips--off': !gs.extractGroupEnabled }"
      >
        <span v-for="name in gs.extractTagNames" :key="name" class="choice-extract-chip">
          <span class="choice-extract-chip-tag">&lt;{{ name }}&gt;</span>
          <i class="fa-solid fa-xmark" :title="t`移除该提取标签`" @click="gs.removeExtractRule(name)"></i>
        </span>
      </div>
    </div>

    <hr class="sysHR" />

    <!-- 全局正则区 -->
    <div class="choice-inline-field-head" data-tour="filter-global-head">
      <span class="choice-inline-label"> <i class="fa-solid fa-globe"></i> {{ t`全局正则区` }} </span>
      <button class="choice-btn-sm choice-btn-new" @click="gs.addFilterGroup('global')">
        <i class="fa-solid fa-plus"></i> {{ t`新增分组` }}
      </button>
    </div>
    <div ref="globalListEl" class="choice-filter-group-list" data-area="global">
      <FilterGroupPanel
        v-for="group in globalGroupsSorted"
        :key="group.id"
        :group-id="group.id"
        :data-group-id="group.id"
        :dimmed="false"
        :show-bindings="false"
        :binding-label="''"
        :binding-icon="''"
        :duplicate-indices="getDuplicateIndices(group.id)"
        @add-from-library="openLibrary(group.id)"
        @delete="onDeleteGroup(group.id)"
        @unbind="() => {}"
      />
      <div v-if="globalGroups.length === 0" class="choice-empty-hint">
        <span>{{ t`暂无全局分组，点击「新增分组」创建` }}</span>
      </div>
    </div>

    <hr class="sysHR" />

    <!-- 预设正则区 -->
    <div class="choice-inline-field-head">
      <span class="choice-inline-label"> <i class="fa-solid fa-sliders"></i> {{ t`预设正则区` }} </span>
      <button class="choice-btn-sm choice-btn-new" @click="gs.addFilterGroup('preset')">
        <i class="fa-solid fa-plus"></i> {{ t`新增分组` }}
      </button>
    </div>
    <div ref="presetListEl" class="choice-filter-group-list" data-area="preset">
      <FilterGroupPanel
        v-for="group in presetGroupsSorted"
        :key="group.id"
        :group-id="group.id"
        :data-group-id="group.id"
        :dimmed="!isPresetActive(group)"
        :show-bindings="true"
        :binding-label="group.preset_name ?? ''"
        :binding-icon="'fa-solid fa-sliders'"
        :duplicate-indices="getDuplicateIndices(group.id)"
        @add-from-library="openLibrary(group.id)"
        @delete="onDeleteGroup(group.id)"
        @unbind="unbindPreset(group)"
        @bind-to-current="bindPresetToCurrent(group)"
      />
      <div v-if="presetGroups.length === 0" class="choice-empty-hint">
        <span>{{ t`暂无预设分组，点击「新增分组」创建` }}</span>
      </div>
    </div>

    <hr class="sysHR" />

    <!-- 角色卡正则区 -->
    <div class="choice-inline-field-head">
      <span class="choice-inline-label"> <i class="fa-solid fa-address-card"></i> {{ t`角色卡正则区` }} </span>
      <button class="choice-btn-sm choice-btn-new" @click="addCharGroup">
        <i class="fa-solid fa-plus"></i> {{ t`新增分组` }}
      </button>
    </div>
    <div ref="charListEl" class="choice-filter-group-list" data-area="character">
      <FilterGroupPanel
        v-for="group in charGroupsSorted"
        :key="group.id"
        :group-id="group.id"
        :data-group-id="group.id"
        :dimmed="!isCharActive(group)"
        :show-bindings="true"
        :binding-label="getCharName(group.character_id)"
        :binding-icon="'fa-solid fa-address-card'"
        :duplicate-indices="getDuplicateIndices(group.id)"
        @add-from-library="openLibrary(group.id)"
        @delete="onDeleteGroup(group.id)"
        @unbind="unbindCharacter(group)"
      />
      <div v-if="charGroups.length === 0" class="choice-empty-hint">
        <span>{{ t`暂无角色卡分组，点击「新增分组」创建` }}</span>
      </div>
    </div>

    <hr class="sysHR" />

    <button
      class="choice-entrypool-btn"
      data-tour="filter-library"
      :title="t`打开正则库管理弹窗`"
      @click="showLibrary = true"
    >
      <i class="fa-solid fa-code"></i>
      {{ t`正则库` }} ({{ gs.settings.filter_settings.regex_library.length }})
    </button>

    <RegexLibraryDialog
      :open="showLibrary"
      :selectable="libraryTargetId !== null"
      :already-referenced-ids="libraryTargetId ? getReferencedIds(libraryTargetId) : new Set()"
      @close="onLibraryClose"
      @confirm="onLibraryConfirm"
    />

    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="t`删除分组`"
      :message="t`确定要删除该分组及其所有规则吗？此操作不可撤销。`"
      :confirm-text="t`删除`"
      :cancel-text="t`取消`"
      @confirm="onDeleteConfirm"
      @cancel="deleteTarget = null"
    />

    <ConfirmDialog
      :open="showCharWarning"
      :title="t`提示`"
      :message="t`请先在酒馆中选择一个角色卡`"
      :confirm-text="t`确定`"
      :cancel-text="''"
      @confirm="showCharWarning = false"
    />
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import { onboardingPendingAction } from '@/core/onboarding';
import RegexLibraryDialog from '@/components/RegexLibraryDialog.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import FilterGroupPanel from '@/components/FilterGroupPanel.vue';
import ChoiceSwitch from '@/components/shared/ChoiceSwitch.vue';
import { this_chid } from '@sillytavern/script';
import { getStCharacter } from '@/core/st-character';
import { DRAG_HANDLE_GROUP_SELECTOR, draggableFilterOptions } from '@/util/sortable';
import type { FilterGroup } from '@/type/settings';
import Sortable from 'sortablejs';

const gs = useGlobalSettingsStore();
const filterGroups = computed(() => gs.settings.filter_settings.groups);

// 快速区输入框：回车/点按钮都走 gs.addExtractRule（内部负责去尖括号、去重、重建分组）
const extractInput = ref('');
const addExtract = () => {
  gs.addExtractRule(extractInput.value);
  extractInput.value = '';
};
// 预览用标签名：与 store 的清洗规则一致（剥掉用户顺手带的尖括号/闭合斜杠），
// 保证"预览显示的标签对"就是实际会匹配的
const extractPreviewName = computed(() => extractInput.value.trim().replace(/^<\/?\s*/, '').replace(/\s*>$/, '').trim());

const globalGroups = computed(() =>
  // 提取专用分组不渲染进全局正则区：提取（保留标签内）与过滤（删除）语义不同，混排
  // 会被当成又一条过滤规则；快速区是提取规则的唯一管理入口（启停/增删都在那里）
  filterGroups.value.filter(g => g.preset_name === null && g.character_id === null && g.id !== gs.extractGroupId),
);
const globalGroupsSorted = computed(() => {
  const groups = [...globalGroups.value];
  return groups.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return 0;
  });
});
const presetGroups = computed(() => filterGroups.value.filter(g => g.preset_name !== null));
const charGroups = computed(() => filterGroups.value.filter(g => g.character_id !== null));

const globalActiveCount = computed(() => globalGroups.value.filter(g => g.enabled).length);
const presetActiveCount = computed(
  () => presetGroups.value.filter(g => g.preset_name === gs.currentPresetName && g.enabled).length,
);
const charActiveCount = computed(
  () => charGroups.value.filter(g => g.character_id === gs.currentCharacterId && g.enabled).length,
);

const presetGroupsSorted = computed(() => {
  const current = gs.currentPresetName;
  const groups = [...presetGroups.value];
  return groups.sort((a, b) => {
    const aActive = a.preset_name === current ? 0 : 1;
    const bActive = b.preset_name === current ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (a.preset_name ?? '').localeCompare(b.preset_name ?? '');
  });
});

const charGroupsSorted = computed(() => {
  const current = gs.currentCharacterId;
  const groups = [...charGroups.value];
  return groups.sort((a, b) => {
    const aActive = a.character_id === current ? 0 : 1;
    const bActive = b.character_id === current ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    // character_id 归一化为字符串后需显式转数值排序（字符串相减会得到 NaN）
    return Number(a.character_id ?? 0) - Number(b.character_id ?? 0);
  });
});

const isPresetActive = (group: FilterGroup) => group.preset_name === gs.currentPresetName;
const isCharActive = (group: FilterGroup) => group.character_id === gs.currentCharacterId;

const currentCharName = computed(() => {
  const ch = getStCharacter(this_chid);
  return ch?.name || t`未选择`;
});

const getCharName = (chid: string | number | null) => {
  if (chid === null) return '';
  return getStCharacter(chid)?.name || `#${chid}`;
};

const unbindPreset = (group: FilterGroup) => {
  group.preset_name = null;
};

const bindPresetToCurrent = (group: FilterGroup) => {
  group.preset_name = gs.currentPresetName;
};

const unbindCharacter = (group: FilterGroup) => {
  group.character_id = null;
};

const showLibrary = ref(false);
const libraryTargetId = ref<string | null>(null);
const deleteTarget = ref<string | null>(null);
const showCharWarning = ref(false);

// 新手引导弹窗状态信号：close-all 归零 / filter-library 打开。filter-reference 步
// 进入时自动关掉正则库——引用流程的锚点（分组按钮）在正则库弹窗之下，弹窗开着时
// 聚光灯只能照到弹窗面板而非按钮
watch(onboardingPendingAction, a => {
  if (a === 'filter-library' || a === 'close-all') {
    showLibrary.value = a === 'filter-library';
    onboardingPendingAction.value = null;
  }
});

const openLibrary = (groupId: string) => {
  libraryTargetId.value = groupId;
  showLibrary.value = true;
};

const onLibraryClose = () => {
  showLibrary.value = false;
  libraryTargetId.value = null;
};

const getReferencedIds = (groupId: string): Set<string> => {
  const group = gs.settings.filter_settings.groups.find(g => g.id === groupId);
  if (!group) return new Set();
  const ids = new Set<string>();
  for (const e of group.entries) {
    if (e.library_entry_id) ids.add(e.library_entry_id);
  }
  return ids;
};

const onLibraryConfirm = (ids: string[]) => {
  const targetId = libraryTargetId.value;
  if (!targetId) {
    libraryTargetId.value = null;
    return;
  }
  const existingIds = getReferencedIds(targetId);
  const newIds = new Set(ids);
  const group = gs.settings.filter_settings.groups.find(g => g.id === targetId);
  if (!group) {
    libraryTargetId.value = null;
    return;
  }
  for (const id of ids) {
    if (!existingIds.has(id)) {
      gs.addFilterGroupEntry(targetId, { library_entry_id: id, inline_rule: null });
    }
  }
  for (const id of existingIds) {
    if (!newIds.has(id)) {
      const idx = group.entries.findIndex(e => e.library_entry_id === id);
      if (idx !== -1) gs.removeFilterGroupEntry(targetId, idx);
    }
  }
  libraryTargetId.value = null;
};

const onDeleteGroup = (id: string) => {
  deleteTarget.value = id;
};

const onDeleteConfirm = () => {
  if (deleteTarget.value) {
    gs.removeFilterGroup(deleteTarget.value);
    deleteTarget.value = null;
  }
};

const addCharGroup = () => {
  if (currentCharName.value === (t`未选择` as string)) {
    showCharWarning.value = true;
    return;
  }
  gs.addFilterGroup('character');
};

const getActiveGroups = computed(() => {
  const preset = gs.currentPresetName;
  const chid = gs.currentCharacterId;
  return gs.settings.filter_settings.groups.filter(g => {
    if (!g.enabled) return false;
    if (g.preset_name !== null && g.preset_name !== preset) return false;
    if (g.character_id !== null && g.character_id !== chid) return false;
    return true;
  });
});

const activeDuplicateKeys = computed(() => {
  const entryKeys = new Map<string, { groupId: string; entryIdx: number }[]>();
  const groups = getActiveGroups.value;
  for (const group of groups) {
    for (let i = 0; i < group.entries.length; i++) {
      const entry = group.entries[i];
      let key: string | null = null;
      if (entry.library_entry_id) {
        key = `lib:${entry.library_entry_id}`;
      } else if (entry.inline_rule) {
        // 三区只有 tag/regex 两种过滤语义（提取只在页顶快速区）；extract 走不进任何分支即不标红
        if (entry.inline_rule.type === 'tag') {
          if (entry.inline_rule.start || entry.inline_rule.end) {
            key = `inline:tag:${entry.inline_rule.start}|||${entry.inline_rule.end}`;
          }
        } else if (entry.inline_rule.type === 'regex' && entry.inline_rule.pattern) {
          key = `inline:regex:${entry.inline_rule.pattern}`;
        }
      }
      if (key) {
        if (!entryKeys.has(key)) entryKeys.set(key, []);
        entryKeys.get(key)!.push({ groupId: group.id, entryIdx: i });
      }
    }
  }
  const duplicates = new Set<string>();
  for (const [, items] of entryKeys) {
    if (items.length > 1) {
      for (const item of items) {
        duplicates.add(`${item.groupId}:${item.entryIdx}`);
      }
    }
  }
  return duplicates;
});

const getDuplicateIndices = (groupId: string): Set<number> => {
  const indices = new Set<number>();
  for (const key of activeDuplicateKeys.value) {
    if (key.startsWith(`${groupId}:`)) {
      indices.add(parseInt(key.split(':')[1], 10));
    }
  }
  return indices;
};

const globalListEl = ref<HTMLElement | null>(null);
const presetListEl = ref<HTMLElement | null>(null);
const charListEl = ref<HTMLElement | null>(null);
const sortables: Sortable[] = [];

function createSortable(el: HTMLElement) {
  return Sortable.create(el, {
    ...draggableFilterOptions,
    animation: 150,
    group: 'filter-groups',
    handle: DRAG_HANDLE_GROUP_SELECTOR,
    onMove: evt => {
      const toArea = (evt.to as HTMLElement).dataset.area;
      // 未绑定角色卡时禁止拖入 character 区；其余路径显式 return true（SortableJS 约定非 false 即放行）
      if (toArea === 'character' && gs.currentCharacterId == null) {
        return false;
      }
      return true;
    },
    onEnd: evt => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
      const fromArea = evt.from.dataset.area;
      const toArea = (evt.to as HTMLElement).dataset.area;
      const groupId = evt.item.dataset.groupId;
      if (!groupId) return;
      const group = gs.settings.filter_settings.groups.find(g => g.id === groupId);
      if (!group) return;
      if (fromArea === toArea) {
        const groups = gs.settings.filter_settings.groups;
        const fromIdx = groups.findIndex(g => g.id === groupId);
        if (fromIdx === -1) return;
        const [moved] = groups.splice(fromIdx, 1);
        const toIdx = groups.findIndex(g => {
          if (toArea === 'global') return g.preset_name === null && g.character_id === null;
          if (toArea === 'preset') return g.preset_name !== null;
          return g.character_id !== null;
        });
        if (toIdx === -1) {
          groups.push(moved);
        } else {
          groups.splice(toIdx + (evt.newIndex > evt.oldIndex ? 1 : 0), 0, moved);
        }
      } else if (toArea === 'global') {
        group.preset_name = null;
        group.character_id = null;
      } else if (toArea === 'preset') {
        group.preset_name = gs.currentPresetName;
        group.character_id = null;
      } else if (toArea === 'character') {
        group.preset_name = null;
        group.character_id = gs.currentCharacterId ?? null;
      }
    },
  });
}

onMounted(() => {
  if (globalListEl.value) sortables.push(createSortable(globalListEl.value));
  if (presetListEl.value) sortables.push(createSortable(presetListEl.value));
  if (charListEl.value) sortables.push(createSortable(charListEl.value));
});

onUnmounted(() => {
  for (const s of sortables) s.destroy();
});
</script>

<style scoped>
.choice-filter-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-filter-group-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

/* 标签提取快速区：视觉上比三个分区更轻（虚线边框卡片），传达"这是更简单的另一条路" */
.choice-extract-quick {
  border: 1px dashed var(--choice-border-active);
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  background: var(--choice-primary-light);
}

.choice-extract-quick-head {
  display: flex;
  align-items: baseline;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

/* 总开关对齐标题行：baseline 布局下开关需要自身居中修正 */
.choice-extract-quick-switch {
  align-self: center;
  margin-left: auto;
}

/* 总开关关闭：chips 灰显但仍可见（规则保留，只是不参与生成） */
.choice-extract-chips--off {
  opacity: 0.45;
}

.choice-extract-quick-desc {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-extract-quick-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

/* 实时预览行：输入标签名后立即演示实际会保留的标签对，讲清"单框填什么" */
.choice-extract-preview {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  line-height: 1.5;
}

.choice-extract-preview-tag {
  font-family: monospace;
  color: var(--choice-primary-hover, var(--choice-primary));
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-sm);
  padding: 0 var(--choice-space-1);
}

.choice-extract-input {
  flex: 1;
  min-width: 0;
  font-size: var(--choice-text-sm);
}

.choice-extract-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-1);
}

.choice-extract-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  padding: 2px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  font-size: var(--choice-text-xs);
}

.choice-extract-chip-tag {
  font-family: monospace;
}

.choice-extract-chip i {
  cursor: pointer;
  color: var(--choice-text-muted);
  transition: color var(--choice-transition);
}

.choice-extract-chip i:hover {
  color: var(--choice-color-error);
}
</style>
