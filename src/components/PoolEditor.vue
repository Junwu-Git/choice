<template>
  <div class="choice-pool-editor">
    <div class="choice-toolbar">
      <div class="choice-seg">
        <button
          v-for="tab in filterTabs"
          :key="tab.value"
          class="choice-seg-btn"
          :class="{ active: filter === tab.value }"
          @click="filter = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="choice-toolbar-actions">
        <button class="menu_button" @click="toggleExpandAll">
          {{ allExpanded ? t`全部收起` : t`全部展开` }}
        </button>
        <button class="menu_button" :disabled="selectedIds.size === 0" @click="importSelected">
          {{ t`复制选中到聊天层(${selectedIds.size})` }}
        </button>
        <button class="menu_button" @click="showGen = true">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          {{ t`AI 生成` }}
        </button>
        <button class="menu_button" @click="addEntry">{{ t`添加条目` }}</button>
      </div>
    </div>

    <div v-if="hasAny" class="choice-pool-list">
      <div v-for="row in rows" :key="row.key" class="choice-pool-entry" :class="{ covered: row.covered }">
        <div class="choice-pool-entry-head" @click="toggleEntry(row.key)">
          <i class="fa-solid" :class="expanded.has(row.key) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span class="choice-layer-badge" :class="`layer-${row.layer}`">{{ row.layerLabel }}</span>
          <span class="choice-entry-summary">{{ entrySummary(row) }}</span>
          <span v-if="row.covered" class="choice-covered-note">{{ t`覆盖` }}</span>
          <span v-if="row.entry.pinned" class="choice-pin-badge">📌</span>
          <input
            v-if="row.importable"
            v-model="selectedIds"
            type="checkbox"
            :value="row.entry.id"
            :title="t`选中后点击复制按钮`"
            @click.stop
          />
          <button class="choice-icon-btn" :title="t`删除`" @click.stop="removeEntry(row)">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <div v-if="expanded.has(row.key)" class="choice-pool-entry-body">
          <textarea v-model="row.entry.text" class="text_pole" :placeholder="t`条目内容`" rows="2"></textarea>
          <div class="choice-pool-entry-fields">
            <label class="choice-check">
              <input v-model="row.entry.pinned" type="checkbox" />
              {{ t`固定` }}
            </label>
            <input
              v-model.number="row.entry.weight"
              class="text_pole choice-small-input"
              type="number"
              min="0"
              :title="t`权重(加权随机)`"
            />
            <input v-model="row.entry.category" class="text_pole" :placeholder="t`分类`" />
            <input v-model="row.entry.condition" class="text_pole" :placeholder="t`条件,如:好感度 >= 60`" />
          </div>
        </div>
      </div>
    </div>
    <div v-else class="choice-empty-hint">{{ t`当前层级暂无条目` }}</div>

    <div class="choice-hint">{{ t`覆盖规则:聊天层 > 角色层 > 全局层,高优先级层有条目时低层不参与抽取` }}</div>

    <PoolGenDialog :open="showGen" :default-layer="genDefaultLayer" @close="showGen = false" @confirm="onGenConfirm" />
  </div>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
import PoolGenDialog from '@/components/PoolGenDialog.vue';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore, type PoolLayer } from '@/store/pool-selector';
import type { PoolEntry } from '@/type/settings';

type FilterTab = 'all' | PoolLayer;

const globalStore = useGlobalSettingsStore();
const characterStore = useCharacterSettingsStore();
const chatStore = useChatSettingsStore();
const poolSelector = usePoolSelectorStore();

const filter = ref<FilterTab>('all');
const selectedIds = ref<Set<string>>(new Set());
const expanded = ref<Set<string>>(new Set());
const allExpanded = ref(false);
const showGen = ref(false);
// AI 生成对话框默认层级：随当前筛选；「全部」时落回聊天层
const genDefaultLayer = computed<PoolLayer>(() => (filter.value === 'all' ? 'chat' : filter.value));

const filterTabs: { value: FilterTab; label: string }[] = [
  { value: 'all', label: t`全部` },
  { value: 'global', label: t`全局` },
  { value: 'character', label: t`角色` },
  { value: 'chat', label: t`聊天` },
];

const layerPriority: Record<PoolLayer, number> = { chat: 0, character: 1, global: 2 };

const layerLabel = (layer: PoolLayer) => {
  switch (layer) {
    case 'global':
      return t`全局`;
    case 'character':
      return t`角色`;
    case 'chat':
      return t`聊天`;
  }
};

const poolOf = (layer: PoolLayer): PoolEntry[] => {
  switch (layer) {
    case 'global':
      return globalStore.settings.pool;
    case 'character':
      return characterStore.settings.pool;
    case 'chat':
      return chatStore.settings.pool;
  }
};

type PoolRow = {
  key: string;
  layer: PoolLayer;
  layerLabel: string;
  entry: PoolEntry;
  covered: boolean;
  importable: boolean;
};

const rows = computed<PoolRow[]>(() => {
  const layers: PoolLayer[] = filter.value === 'all' ? ['global', 'character', 'chat'] : [filter.value];
  const result: PoolRow[] = [];
  for (const layer of layers) {
    const covered = layerPriority[layer] > layerPriority[poolSelector.effectiveLayer];
    for (const entry of poolOf(layer)) {
      result.push({
        key: `${layer}:${entry.id}`,
        layer,
        layerLabel: layerLabel(layer),
        entry,
        covered,
        importable: layer !== 'chat',
      });
    }
  }
  return result;
});

const hasAny = computed(() => rows.value.length > 0);

const entrySummary = (row: PoolRow): string => {
  const text = row.entry.text.trim();
  if (!text) return t`<空条目>`;
  if (text.includes(': ')) {
    const parts = text.split(': ');
    return parts[0].replace(/"/g, '') + ' | ' + parts.slice(1).join(': ').replace(/"/g, '').slice(0, 40);
  }
  return text.replace(/"/g, '').slice(0, 50);
};

const toggleEntry = (key: string) => {
  if (expanded.value.has(key)) expanded.value.delete(key);
  else expanded.value.add(key);
};

const toggleExpandAll = () => {
  if (allExpanded.value) {
    expanded.value = new Set();
    allExpanded.value = false;
  } else {
    expanded.value = new Set(rows.value.map(r => r.key));
    allExpanded.value = true;
  }
};

const addEntry = () => {
  const target: PoolLayer = filter.value === 'all' ? 'chat' : filter.value;
  const entry: PoolEntry = {
    id: uuidv4(),
    text: '',
    pinned: false,
    weight: 1,
    category: '',
    condition: '',
  };
  poolOf(target).push(entry);
  expanded.value.add(`${target}:${entry.id}`);
};

const removeEntry = (row: PoolRow) => {
  const pool = poolOf(row.layer);
  const index = pool.findIndex(entry => entry.id === row.entry.id);
  if (index !== -1) {
    pool.splice(index, 1);
  }
  selectedIds.value.delete(row.entry.id);
  expanded.value.delete(row.key);
};

const importSelected = () => {
  for (const layer of ['global', 'character'] as PoolLayer[]) {
    for (const entry of poolOf(layer)) {
      if (selectedIds.value.has(entry.id)) {
        chatStore.settings.pool.push({
          ...klona(entry),
          id: uuidv4(),
        });
      }
    }
  }
  selectedIds.value = new Set();
};

// 注入选中项：替换项原地改目标条目 text（保留 id/位置/固定/权重/分类/条件），新增项 push
// 直接改 store 数组，深层 watch 已自动持久化（与「添加条目」同一通道）
const onGenConfirm = ({
  additions,
  replacements,
  layer,
}: {
  additions: PoolEntry[];
  replacements: { id: string; text: string }[];
  layer: PoolLayer;
}) => {
  const pool = poolOf(layer);
  for (const r of replacements) {
    const target = pool.find(e => e.id === r.id);
    if (target) target.text = r.text;
  }
  if (additions.length) pool.push(...additions);
  showGen.value = false;
};
</script>

<style scoped>
.choice-pool-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: nowrap;
}

.choice-toolbar-actions {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  flex-shrink: 0;
}

.choice-seg {
  display: inline-flex;
  border: 1px solid rgba(128, 128, 128, 0.4);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}

.choice-seg-btn {
  background: rgba(60, 60, 60, 0.4);
  color: #dcdcdc;
  border: none;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.choice-seg-btn.active {
  background: #4a90d9;
  color: #fff;
}

.choice-pool-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.choice-pool-entry {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  background: rgba(40, 40, 40, 0.35);
  overflow: hidden;
}

.choice-pool-entry.covered {
  opacity: 0.5;
}

.choice-pool-entry-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
  min-height: 0;
}

.choice-pool-entry-head:hover {
  background: rgba(255, 255, 255, 0.04);
}

.choice-entry-summary {
  flex: 1;
  font-size: 12px;
  color: #d0d0d0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.choice-pin-badge {
  font-size: 11px;
  flex-shrink: 0;
}

.choice-pool-entry-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 8px 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  padding-top: 6px;
}

.choice-layer-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  color: #fff;
  flex-shrink: 0;
}

.choice-layer-badge.layer-global {
  background: #5a8a5a;
}

.choice-layer-badge.layer-character {
  background: #8a6a4a;
}

.choice-layer-badge.layer-chat {
  background: #4a6a8a;
}

.choice-covered-note {
  font-size: 10px;
  color: #b8943a;
  flex-shrink: 0;
}

.choice-pool-entry-fields {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.choice-small-input {
  width: 56px;
}

.choice-icon-btn {
  background: transparent;
  color: #c86a6a;
  border: none;
  cursor: pointer;
  font-size: 13px;
  flex-shrink: 0;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #dcdcdc;
  white-space: nowrap;
}

.choice-empty-hint {
  color: #9a9a9a;
  font-size: 12px;
  padding: 8px 0;
}

.choice-hint {
  color: #9a9a9a;
  font-size: 11px;
}
</style>
