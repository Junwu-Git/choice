<template>
  <Teleport to="body">
    <div v-if="open" class="choice-poolgen-overlay" @click.self="emit('close')">
      <div class="choice-poolgen-dialog">
        <div class="choice-poolgen-header">
          <span class="choice-poolgen-title">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            {{ t`AI 生成条目` }}
          </span>
          <button class="choice-poolgen-close" :title="t`取消`" @click="emit('close')">&times;</button>
        </div>

        <div class="choice-poolgen-body">
          <div class="choice-poolgen-form">
            <label class="choice-poolgen-field">
              <span>{{ t`条目数` }}</span>
              <input v-model.number="count" class="text_pole" type="number" min="1" max="50" />
            </label>
            <label class="choice-poolgen-field">
              <span>{{ t`生成要求` }}</span>
              <textarea v-model="requirements" class="text_pole" rows="4" :placeholder="t`生成要求`"></textarea>
            </label>
            <div class="choice-poolgen-options">
              <label class="choice-poolgen-check">
                <input v-model="includeContext" type="checkbox" />
                {{ t`结合近期对话` }}
              </label>
              <label class="choice-poolgen-field choice-poolgen-layer">
                <span>{{ t`注入到` }}</span>
                <select v-model="layer" class="text_pole">
                  <option value="global">{{ t`全局` }}</option>
                  <option value="character">{{ t`角色` }}</option>
                  <option value="chat">{{ t`聊天` }}</option>
                </select>
              </label>
            </div>
            <div class="choice-poolgen-hint">{{ t`注入到低层(如全局)后,若聊天层非空,新条目本轮抽取不生效` }}</div>
          </div>

          <div class="choice-poolgen-actions">
            <button class="menu_button" :disabled="poolGenState.loading" @click="doGenerate">
              <i v-if="poolGenState.loading" class="fa-solid fa-spinner fa-spin"></i>
              {{ poolGenState.loading ? t`生成中…` : results.length > 0 ? t`重新生成` : t`生成` }}
            </button>
            <button v-if="poolGenState.loading" class="menu_button" @click="cancelPoolGen()">{{ t`取消` }}</button>
          </div>

          <div v-if="results.length > 0" class="choice-poolgen-results">
            <div class="choice-poolgen-results-head">
              <button class="menu_button choice-poolgen-selall" @click="toggleSelectAll">
                {{ selected.size === results.length ? t`全不选` : t`全选` }}
              </button>
              <span class="choice-poolgen-results-count">{{ t`已选中` }} {{ selected.size }}/{{ results.length }}</span>
            </div>
            <div
              v-for="(item, i) in results"
              :key="i"
              class="choice-poolgen-result-row"
              :class="{ 'is-replace': !!item.replaceTargetId }"
            >
              <input v-model="selected" type="checkbox" :value="i" />
              <div class="choice-poolgen-result-main">
                <div v-if="item.replaceTargetId" class="choice-poolgen-replace-info">
                  <span class="choice-poolgen-replace-badge">{{ t`替换` }}</span>
                  <span class="choice-poolgen-orig">{{ t`原条目` }}：{{ item.replaceOriginal?.slice(0, 24) }}</span>
                </div>
                <textarea v-model="item.text" class="text_pole" rows="1"></textarea>
              </div>
              <button class="choice-icon-btn" :title="t`删除`" @click="removeResult(i)">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
          <div v-else-if="attempted && !poolGenState.loading" class="choice-poolgen-empty">{{ t`尚无结果` }}</div>

          <div class="choice-poolgen-footer">
            <button class="menu_button" :disabled="selected.size === 0 || poolGenState.loading" @click="onInject">
              {{ t`注入` }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
import { cancelPoolGen, generatePoolEntries, poolGenState, type PoolGenItem } from '@/core/generator';
import type { PoolLayer } from '@/store/pool-selector';
import type { PoolEntry } from '@/type/settings';

const props = defineProps<{ open: boolean; defaultLayer: PoolLayer }>();
const emit = defineEmits<{
  close: [];
  confirm: [payload: { layer: PoolLayer; additions: PoolEntry[]; replacements: { id: string; text: string }[] }];
}>();

const count = ref(6);
const requirements = ref('');
const includeContext = ref(true);
// 注入层级：打开时随 PoolEditor 当前筛选，否则 chat
const layer = ref<PoolLayer>('chat');
const results = ref<PoolGenItem[]>([]);
const selected = ref<Set<number>>(new Set());
const attempted = ref(false);

// 打开时重置结果并同步默认层级，避免上一次的残留条目混入本轮
watch(
  () => props.open,
  open => {
    if (open) {
      results.value = [];
      selected.value = new Set();
      attempted.value = false;
      layer.value = props.defaultLayer;
    } else {
      // 关闭即取消在途生成：否则 loading 拘留会阻塞再次打开（超时 0 + 请求挂起时无 UI 恢复手段）
      cancelPoolGen();
    }
  },
  { immediate: true },
);

// 切换注入层后，旧结果（序号→id 映射）不再对应，清空强制重生成
watch(layer, () => {
  if (results.value.length) {
    results.value = [];
    selected.value = new Set();
  }
});

const doGenerate = async () => {
  const n = Math.max(1, Math.floor(count.value) || 1);
  // 记住发起生成时的层；在途期间用户可能切层，旧层结果（替换目标 id 指向旧层）与新层不匹配
  const startLayer = layer.value;
  attempted.value = true;
  results.value = [];
  selected.value = new Set();
  const items = await generatePoolEntries({
    count: n,
    requirements: requirements.value,
    includeContext: includeContext.value,
    layer: startLayer,
  });
  // 生成在途期间切换了注入层 → 丢弃过期结果（替换目标 id 已不对应新层，注入会静默错位）
  if (layer.value !== startLayer) return;
  if (items.length) {
    results.value = items;
    // 默认全选，用户可逐条取消
    selected.value = new Set(items.map((_, i) => i));
  }
};

const toggleSelectAll = () => {
  if (selected.value.size === results.value.length) {
    selected.value = new Set();
  } else {
    selected.value = new Set(results.value.map((_, i) => i));
  }
};

// 删除条目后下方索引上移，需重建选中集合以免错位
const removeResult = (i: number) => {
  results.value.splice(i, 1);
  const next = new Set<number>();
  for (const idx of selected.value) {
    if (idx === i) continue;
    next.add(idx > i ? idx - 1 : idx);
  }
  selected.value = next;
};

// 仅注入选中的项：替换项原地改目标条目 text，新增项 push
const onInject = () => {
  const additions: PoolEntry[] = [];
  const replacements: { id: string; text: string }[] = [];
  for (const i of [...selected.value].sort((a, b) => a - b)) {
    const item = results.value[i];
    if (!item) continue;
    const text = item.text.trim();
    if (!text) continue;
    if (item.replaceTargetId) {
      replacements.push({ id: item.replaceTargetId, text });
    } else {
      additions.push({
        id: uuidv4(),
        text,
        pinned: false,
        weight: 1,
        category: '',
        condition: '',
      });
    }
  }
  if (!additions.length && !replacements.length) return;
  emit('confirm', { layer: layer.value, additions, replacements });
  emit('close');
};
</script>

<style scoped>
.choice-poolgen-overlay {
  position: fixed;
  inset: 0;
  z-index: 10002;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-poolgen-dialog {
  width: 520px;
  max-width: 92vw;
  max-height: 85vh;
  background: #1e1e1e;
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-poolgen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(50, 50, 50, 0.6);
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.choice-poolgen-title {
  font-size: 14px;
  font-weight: bold;
  color: #e8e8e8;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice-poolgen-close {
  background: none;
  border: none;
  color: #a0a0a0;
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}

.choice-poolgen-close:hover {
  color: #e8e8e8;
}

.choice-poolgen-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  overflow-y: auto;
  flex: 1;
}

.choice-poolgen-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-poolgen-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #dcdcdc;
}

.choice-poolgen-field .text_pole {
  width: 100%;
}

.choice-poolgen-options {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.choice-poolgen-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #dcdcdc;
  white-space: nowrap;
  margin-bottom: 4px;
}

.choice-poolgen-layer {
  flex: 1;
  min-width: 140px;
}

.choice-poolgen-hint {
  color: #9a9a9a;
  font-size: 11px;
  line-height: 1.4;
}

.choice-poolgen-actions {
  display: flex;
  gap: 6px;
}

.choice-poolgen-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.choice-poolgen-results-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.choice-poolgen-selall {
  font-size: 11px;
}

.choice-poolgen-results-count {
  font-size: 11px;
  color: #9a9a9a;
}

.choice-poolgen-result-row {
  display: flex;
  gap: 4px;
  align-items: stretch;
  border-radius: 4px;
}

/* 替换建议行用琥珀色与新增行区分 */
.choice-poolgen-result-row.is-replace {
  border-left: 3px solid #b8943a;
  background: rgba(184, 148, 58, 0.08);
}

.choice-poolgen-result-row > input[type='checkbox'] {
  flex-shrink: 0;
  margin-top: 4px;
}

.choice-poolgen-result-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.choice-poolgen-result-main .text_pole {
  flex: 1;
  min-width: 0;
  resize: vertical;
}

.choice-poolgen-replace-info {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.choice-poolgen-replace-badge {
  color: #b8943a;
  font-size: 10px;
  font-weight: bold;
  border: 1px solid #b8943a;
  border-radius: 4px;
  padding: 0 4px;
  white-space: nowrap;
}

.choice-poolgen-orig {
  color: #9a9a9a;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.choice-poolgen-empty {
  color: #9a9a9a;
  font-size: 12px;
  padding: 8px 0;
}

.choice-poolgen-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  border-top: 1px solid rgba(128, 128, 128, 0.15);
  padding-top: 10px;
}

.choice-icon-btn {
  background: transparent;
  color: #c86a6a;
  border: none;
  cursor: pointer;
  font-size: 13px;
  flex-shrink: 0;
}
</style>
