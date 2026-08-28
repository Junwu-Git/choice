<template>
  <div v-if="group" class="choice-filter-group-card" :class="{ 'choice-filter-group-dimmed': dimmed }">
    <div class="choice-filter-group-header" @click="expanded = !expanded">
      <i class="fa-solid choice-filter-group-caret" :class="expanded ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
      <span v-if="renamingId !== groupId" class="choice-filter-group-name">{{ group.name }}</span>
      <input
        v-else
        ref="renameInput"
        v-model="renameText"
        class="text_pole"
        style="width: 100px; font-size: var(--choice-text-xs); flex-shrink: 0"
        @keydown.enter="finishRename"
        @keydown.escape="cancelRename"
        @click.stop
      />
      <button v-if="dimmed && locked" class="choice-icon-btn" :title="t`点击解锁后可编辑`" @click.stop="locked = false">
        <i class="fa-solid fa-lock"></i>
      </button>
      <button
        v-else-if="dimmed && !locked"
        class="choice-icon-btn"
        :title="t`已解锁，可编辑`"
        @click.stop="locked = true"
      >
        <i class="fa-solid fa-lock-open"></i>
      </button>
      <button
        class="choice-icon-btn"
        :disabled="dimmed && locked"
        :title="renamingId === groupId ? t`保存` : t`重命名`"
        @click.stop="renamingId === groupId ? finishRename() : startRename()"
      >
        <i :class="renamingId === groupId ? 'fa-solid fa-check' : 'fa-solid fa-pen-to-square'"></i>
      </button>
      <button v-if="renamingId === groupId" class="choice-icon-btn" :title="t`取消`" @click.stop="cancelRename">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <label class="choice-check" :title="group.enabled ? t`启用` : t`禁用`" @click.stop>
        <input type="checkbox" :checked="group.enabled" :disabled="dimmed && locked" @change="toggleEnabled" />
      </label>
      <button
        class="choice-icon-btn"
        :disabled="dimmed && locked"
        :title="t`从正则库添加`"
        @click.stop="emit('addFromLibrary')"
      >
        <i class="fa-solid fa-book-open"></i>
      </button>
      <button class="choice-icon-btn" :disabled="dimmed && locked" :title="t`新增规则`" @click.stop="addInlineRule">
        <i class="fa-solid fa-plus"></i>
      </button>
      <button
        class="choice-icon-btn choice-delete-btn"
        :disabled="dimmed && locked"
        :title="t`删除分组`"
        @click.stop="emit('delete')"
      >
        <i class="fa-solid fa-trash-can"></i>
      </button>

      <template v-if="showBindings">
        <span class="choice-filter-binding">
          <i :class="bindingIcon"></i>
          <span class="choice-bound-badge" :class="{ 'choice-bound-char': bindingIcon.includes('address-card') }">
            {{ bindingLabel || t`未绑定` }}
          </span>
        </span>
        <button v-if="bindingLabel" class="choice-icon-btn" :title="t`取消绑定`" @click.stop="emit('unbind')">
          <i class="fa-solid fa-link-slash"></i>
        </button>
      </template>
    </div>
    <div v-if="expanded" ref="entriesBody" class="choice-filter-group-body">
      <div
        v-for="(entry, idx) in group.entries"
        :key="idx"
        class="choice-filter-row"
        :class="{ 'choice-filter-row--duplicate': duplicateIndices.has(idx) }"
        :data-entry-idx="idx"
      >
        <template v-if="entry.library_entry_id">
          <span class="choice-inline-cat-badge">
            <i class="fa-solid fa-bookmark"></i>
            <span class="choice-lib-ref-cat">{{ getLibEntryCategory(entry.library_entry_id) }}</span>
            <span class="choice-lib-ref-sep">›</span>
            <span>{{ getLibEntryDisplay(entry.library_entry_id) }}</span>
          </span>
          <button class="choice-icon-btn choice-delete-btn" :disabled="dimmed && locked" @click="removeEntry(idx)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </template>
        <template v-else>
          <select
            v-model="entry.inline_rule!.type"
            class="text_pole"
            style="width: 90px; flex-shrink: 0"
            :disabled="dimmed && locked"
          >
            <option value="tag">{{ t`标签匹配` }}</option>
            <option value="regex">{{ t`正则表达式` }}</option>
          </select>
          <template v-if="entry.inline_rule!.type === 'tag'">
            <input
              v-model="entry.inline_rule!.start"
              class="text_pole"
              :placeholder="t`标签头`"
              style="flex: 1; min-width: 0"
              :disabled="dimmed && locked"
            />
            <input
              v-model="entry.inline_rule!.end"
              class="text_pole"
              :placeholder="t`标签尾`"
              style="flex: 1; min-width: 0"
              :disabled="dimmed && locked"
            />
          </template>
          <input
            v-else
            v-model="entry.inline_rule!.pattern"
            class="text_pole"
            :placeholder="t`正则表达式`"
            style="flex: 1; min-width: 0"
            :disabled="dimmed && locked"
          />
          <button class="choice-icon-btn choice-delete-btn" :disabled="dimmed && locked" @click="removeEntry(idx)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </template>
      </div>
      <div v-if="group.entries.length === 0" class="choice-empty-hint">
        <span>{{ t`暂无规则，点击「从正则库添加」或「+」添加` }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import Sortable from 'sortablejs';

const props = withDefaults(
  defineProps<{
    groupId: string;
    dimmed: boolean;
    showBindings: boolean;
    bindingLabel: string;
    bindingIcon: string;
    duplicateIndices: Set<number>;
  }>(),
  {
    duplicateIndices: () => new Set(),
  },
);

const emit = defineEmits<{
  addFromLibrary: [];
  delete: [];
  unbind: [];
}>();

const gs = useGlobalSettingsStore();
const expanded = ref(true);
const renamingId = ref<string | null>(null);
const renameText = ref('');
const locked = ref(true);

watch(
  () => props.dimmed,
  d => {
    if (d) locked.value = true;
  },
);

const group = computed(() => gs.settings.filter_settings.groups.find(g => g.id === props.groupId) ?? null);

const getLibEntryCategory = (id: string) => {
  const entry = gs.settings.filter_settings.regex_library.find(e => e.id === id);
  return entry?.category || t`未分组`;
};

const getLibEntryDisplay = (id: string) => {
  const entry = gs.settings.filter_settings.regex_library.find(e => e.id === id);
  if (!entry) return '(已删除)';
  if (entry.type === 'tag') return `${entry.start || '...'} ... ${entry.end || '...'}`;
  return entry.pattern || '(空)';
};

const toggleEnabled = () => {
  const g = group.value;
  if (g) g.enabled = !g.enabled;
};

const addInlineRule = () => {
  gs.addFilterGroupEntry(props.groupId, {
    library_entry_id: null,
    inline_rule: { type: 'tag', start: '', end: '' },
  });
  expanded.value = true;
};

const removeEntry = (idx: number) => {
  gs.removeFilterGroupEntry(props.groupId, idx);
};

const startRename = () => {
  renamingId.value = props.groupId;
  const g = group.value;
  if (g) renameText.value = g.name;
};

const finishRename = () => {
  const t = renameText.value.trim();
  const g = group.value;
  if (t && g) g.name = t;
  renamingId.value = null;
};

const cancelRename = () => {
  renamingId.value = null;
};

const entriesBody = ref<HTMLElement | null>(null);
let sortable: Sortable | null = null;

onMounted(() => {
  watch(
    entriesBody,
    el => {
      if (sortable) sortable.destroy();
      if (!el) return;
      sortable = Sortable.create(el, {
        animation: 150,
        handle: '.choice-filter-row',
        onEnd: evt => {
          if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
          const g = group.value;
          if (!g) return;
          const [moved] = g.entries.splice(evt.oldIndex, 1);
          g.entries.splice(evt.newIndex, 0, moved);
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
.choice-filter-group-card {
  border-radius: var(--choice-radius-sm);
  border: 1px solid var(--choice-border);
  background: var(--choice-bg-card);
  overflow: hidden;
}

.choice-filter-group-dimmed {
  opacity: 0.45;
  filter: grayscale(30%);
}

.choice-filter-group-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  font-size: var(--choice-text-sm);
  user-select: none;
  cursor: pointer;
}

.choice-filter-group-caret {
  color: var(--choice-text-muted);
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  width: 16px;
  text-align: center;
}

.choice-filter-group-name {
  flex: 1;
  font-weight: 600;
  color: var(--choice-text-secondary);
  min-width: 0;
}

.choice-filter-group-body {
  padding: var(--choice-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  border-top: 1px solid var(--choice-border);
}

.choice-filter-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-filter-row--duplicate {
  border: 1px solid var(--choice-color-error);
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-1);
  margin: calc(-1 * var(--choice-space-1));
}

.choice-filter-row input {
  font-size: var(--choice-text-sm);
}

.choice-filter-binding {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  margin-left: auto;
  white-space: nowrap;
}

.choice-lib-ref-cat {
  font-size: var(--choice-text-xs);
  opacity: 0.7;
}

.choice-lib-ref-sep {
  opacity: 0.5;
  margin: 0 2px;
}
</style>
