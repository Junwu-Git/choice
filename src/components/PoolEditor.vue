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
        <button class="menu_button" :disabled="selectedIds.size === 0" @click="importSelected">
          {{ t`复制选中到聊天层(${selectedIds.size})` }}
        </button>
        <button class="menu_button" @click="addEntry">{{ t`添加条目` }}</button>
      </div>
    </div>

    <div v-if="hasAny" class="choice-pool-list">
      <div v-for="row in rows" :key="row.key" class="choice-pool-entry" :class="{ covered: row.covered }">
        <div class="choice-pool-entry-head">
          <span class="choice-layer-badge" :class="`layer-${row.layer}`">{{ row.layerLabel }}</span>
          <span v-if="row.covered" class="choice-covered-note">{{ t`当前被更高层覆盖` }}</span>
          <input
            v-if="row.importable"
            v-model="selectedIds"
            type="checkbox"
            :value="row.entry.id"
            :title="t`选中后点击复制按钮`"
          />
          <button class="choice-icon-btn" :title="t`删除`" @click="removeEntry(row)">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
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
    <div v-else class="choice-empty-hint">{{ t`当前层级暂无条目` }}</div>

    <div class="choice-hint">{{ t`覆盖规则:聊天层 > 角色层 > 全局层,高优先级层有条目时低层不参与抽取` }}</div>
  </div>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
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

const addEntry = () => {
  const target: PoolLayer = filter.value === 'all' ? 'chat' : filter.value;
  poolOf(target).push({
    id: uuidv4(),
    text: '',
    pinned: false,
    weight: 1,
    category: '',
    condition: '',
  });
};

const removeEntry = (row: PoolRow) => {
  const pool = poolOf(row.layer);
  const index = pool.findIndex(entry => entry.id === row.entry.id);
  if (index !== -1) {
    pool.splice(index, 1);
  }
  selectedIds.value.delete(row.entry.id);
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
  gap: 8px;
  flex-wrap: wrap;
}

.choice-toolbar-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.choice-seg {
  display: inline-flex;
  border: 1px solid rgba(128, 128, 128, 0.4);
  border-radius: 6px;
  overflow: hidden;
}

.choice-seg-btn {
  background: rgba(60, 60, 60, 0.4);
  color: #dcdcdc;
  border: none;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.choice-seg-btn.active {
  background: #4a90d9;
  color: #fff;
}

.choice-pool-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-pool-entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 8px;
  padding: 8px;
  background: rgba(40, 40, 40, 0.4);
}

.choice-pool-entry.covered {
  opacity: 0.55;
}

.choice-pool-entry.covered .choice-pool-entry-head .text_pole,
.choice-pool-entry.covered .text_pole {
  text-decoration: line-through;
}

.choice-pool-entry-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.choice-layer-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  color: #fff;
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
  font-size: 11px;
  color: #b8943a;
}

.choice-pool-entry-fields {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.choice-small-input {
  width: 64px;
}

.choice-icon-btn {
  background: transparent;
  color: #c86a6a;
  border: none;
  cursor: pointer;
  font-size: 14px;
  margin-left: auto;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
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
