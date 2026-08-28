<template>
  <div class="choice-filter-editor">
    <!-- 状态栏 -->
    <div class="choice-config-status">
      <span class="choice-config-status-label">{{ t`当前生效` }}:</span>
      <span class="choice-bound-badge">
        <i class="fa-solid fa-globe"></i> {{ t`全局` }} {{ globalActiveCount }}
      </span>
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

    <!-- 全局正则区 -->
    <div class="choice-inline-field-head">
      <span class="choice-inline-label">
        <i class="fa-solid fa-globe"></i> {{ t`全局正则区` }}
      </span>
      <button class="choice-btn-sm choice-btn-new" @click="gs.addFilterGroup('global')">
        <i class="fa-solid fa-plus"></i> {{ t`新增分组` }}
      </button>
    </div>
    <div ref="globalListEl" class="choice-filter-group-list" data-area="global">
      <FilterGroupPanel
        v-for="group in globalGroups"
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
      <span class="choice-inline-label">
        <i class="fa-solid fa-sliders"></i> {{ t`预设正则区` }}
      </span>
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
      />
      <div v-if="presetGroups.length === 0" class="choice-empty-hint">
        <span>{{ t`暂无预设分组，点击「新增分组」创建` }}</span>
      </div>
    </div>

    <hr class="sysHR" />

    <!-- 角色卡正则区 -->
    <div class="choice-inline-field-head">
      <span class="choice-inline-label">
        <i class="fa-solid fa-address-card"></i> {{ t`角色卡正则区` }}
      </span>
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

    <button class="choice-entrypool-btn" :title="t`打开正则库管理弹窗`" @click="showLibrary = true">
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
import RegexLibraryDialog from '@/components/RegexLibraryDialog.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import FilterGroupPanel from '@/components/FilterGroupPanel.vue';
import { characters, this_chid } from '@sillytavern/script';
import type { FilterGroup } from '@/type/settings';
import Sortable from 'sortablejs';

const gs = useGlobalSettingsStore();
const filterGroups = computed(() => gs.settings.filter_settings.groups);

const globalGroups = computed(() => filterGroups.value.filter(g => g.preset_name === null && g.character_id === null));
const presetGroups = computed(() => filterGroups.value.filter(g => g.preset_name !== null));
const charGroups = computed(() => filterGroups.value.filter(g => g.character_id !== null));

const globalActiveCount = computed(() => globalGroups.value.filter(g => g.enabled).length);
const presetActiveCount = computed(() => presetGroups.value.filter(g => g.preset_name === gs.currentPresetName && g.enabled).length);
const charActiveCount = computed(() => charGroups.value.filter(g => g.character_id === gs.currentCharacterId && g.enabled).length);

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
    return (a.character_id ?? 0) - (b.character_id ?? 0);
  });
});

const isPresetActive = (group: FilterGroup) => group.preset_name === gs.currentPresetName;
const isCharActive = (group: FilterGroup) => group.character_id === gs.currentCharacterId;

const currentCharName = computed(() => {
  try {
    const chid = this_chid;
    if (chid !== undefined && characters?.[chid]) {
      return characters[chid].name || `#${chid}`;
    }
    return t`未选择`;
  } catch {
    return t`未选择`;
  }
});

const getCharName = (chid: number | null) => {
  if (chid === null) return '';
  try {
    return characters?.[chid]?.name || `#${chid}`;
  } catch {
    return `#${chid}`;
  }
};

const unbindPreset = (group: FilterGroup) => {
  group.preset_name = null;
};

const unbindCharacter = (group: FilterGroup) => {
  group.character_id = null;
};

const showLibrary = ref(false);
const libraryTargetId = ref<string | null>(null);
const deleteTarget = ref<string | null>(null);
const showCharWarning = ref(false);

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
  if (!targetId) { libraryTargetId.value = null; return; }
  const existingIds = getReferencedIds(targetId);
  const newIds = new Set(ids);
  const group = gs.settings.filter_settings.groups.find(g => g.id === targetId);
  if (!group) { libraryTargetId.value = null; return; }
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
        if (entry.inline_rule.type === 'tag') {
          if (entry.inline_rule.start || entry.inline_rule.end) {
            key = `inline:tag:${entry.inline_rule.start}|||${entry.inline_rule.end}`;
          }
        } else {
          if (entry.inline_rule.pattern) {
            key = `inline:regex:${entry.inline_rule.pattern}`;
          }
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

function createSortable(el: HTMLElement, area: string) {
  return Sortable.create(el, {
    animation: 150,
    group: 'filter-groups',
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
        if (toIdx === -1) { groups.push(moved); } else { groups.splice(toIdx + (evt.newIndex > evt.oldIndex ? 1 : 0), 0, moved); }
      } else {
        if (toArea === 'global') {
          group.preset_name = null;
          group.character_id = null;
        } else if (toArea === 'preset') {
          group.preset_name = gs.currentPresetName;
          group.character_id = null;
        } else if (toArea === 'character') {
          group.preset_name = null;
          group.character_id = gs.currentCharacterId ?? null;
        }
      }
    },
  });
}

onMounted(() => {
  if (globalListEl.value) sortables.push(createSortable(globalListEl.value, 'global'));
  if (presetListEl.value) sortables.push(createSortable(presetListEl.value, 'preset'));
  if (charListEl.value) sortables.push(createSortable(charListEl.value, 'character'));
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
</style>