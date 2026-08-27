<template>
  <Teleport to="body">
    <div v-if="open" class="choice-poolgen-overlay" @click.self="emit('close')">
      <div class="choice-poolgen-dialog">
        <div class="choice-poolgen-header">
          <span class="choice-poolgen-title">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            {{ t`AI 生成条目` }}
          </span>
          <div style="display: inline-flex; gap: 3px; align-items: center">
            <button
              ref="guideBtn"
              class="choice-poolgen-close"
              :title="t`页面指引`"
              @click="showGuide = !showGuide"
              style="font-size: var(--choice-text-sm)"
            >
              <i class="fa-solid fa-circle-question"></i>
            </button>
            <button class="choice-poolgen-close" :title="t`取消`" @click="emit('close')">&times;</button>
          </div>
        </div>

        <div class="choice-poolgen-body choice-scrollbar">
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
              <label class="choice-poolgen-field" style="flex-direction: row; align-items: center; gap: 6px">
                <span>{{ t`目标分组` }}</span>
                <select v-model="targetCategory" class="text_pole" style="width: auto; min-width: 100px">
                  <option value="">{{ t`未分组` }}</option>
                  <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
                </select>
              </label>
            </div>
            <div class="choice-poolgen-hint">{{ t`生成的条目将注入到总条目库，可在配置中勾选后使用` }}</div>
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
              <span class="choice-poolgen-index">{{ i + 1 }}</span>
              <input v-model="selected" type="checkbox" :value="i" />
              <div class="choice-poolgen-result-main">
                <div v-if="item.replaceTargetId" class="choice-poolgen-replace-info">
                  <span class="choice-poolgen-replace-badge">{{ t`替换` }}</span>
                  <span class="choice-poolgen-orig">{{ t`原条目` }}：{{ item.replaceOriginal?.slice(0, 24) }}</span>
                </div>
                <textarea v-model="item.type" class="text_pole" rows="1" :placeholder="t`类型`"></textarea>
                <textarea v-model="item.content" class="text_pole" rows="1" :placeholder="t`内容`"></textarea>
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

        <GuidePopover
          :visible="showGuide"
          :anchor-el="guideBtn"
          icon="fa-solid fa-wand-magic-sparkles"
          title="AI 生成条目"
          @close="showGuide = false"
        >
          <div v-html="guideHtml"></div>
        </GuidePopover>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
import { cancelPoolGen, generatePoolEntries, poolGenState, type PoolGenItem } from '@/core/generator';
import type { PoolEntry } from '@/type/settings';
import GuidePopover from '@/components/GuidePopover.vue';

const props = defineProps<{ open: boolean; categories: string[] }>();
const emit = defineEmits<{
  close: [];
  confirm: [payload: { additions: PoolEntry[]; replacements: { id: string; type: string; content: string }[] }];
}>();

const count = ref(6);
const requirements = ref('');
const includeContext = ref(true);
const targetCategory = ref('');
const results = ref<PoolGenItem[]>([]);
const selected = ref<Set<number>>(new Set());
const attempted = ref(false);
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const guideHtml = `<p><strong>作用</strong>：让 AI 根据你的要求自动生成一批条目，省去手动输入的麻烦。</p>
<p><strong>参数</strong>：条目数控制生成数量，生成要求描述你想要什么类型的条目（如"战斗中的行动选项，每个选项 15 字以内"），目标分组决定生成后放到哪个分组。</p>
<p><strong>结合近期对话</strong>：勾选后 AI 会参考最近的聊天内容生成更贴合场景的条目。</p>
<p><strong>生成后</strong>：勾选需要的条目，点击"注入"将它们加入条目库。未勾选的条目会被丢弃。</p>`;

watch(
  () => props.open,
  open => {
    if (open) {
      results.value = [];
      selected.value = new Set();
      attempted.value = false;
      targetCategory.value = '';
    } else {
      cancelPoolGen();
    }
  },
  { immediate: true },
);

const doGenerate = async () => {
  const n = Math.max(1, Math.floor(count.value) || 1);
  attempted.value = true;
  results.value = [];
  selected.value = new Set();
  const items = await generatePoolEntries({
    count: n,
    requirements: requirements.value,
    includeContext: includeContext.value,
  });
  if (items.length) {
    results.value = items;
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

const removeResult = (i: number) => {
  results.value.splice(i, 1);
  const next = new Set<number>();
  for (const idx of selected.value) {
    if (idx === i) continue;
    next.add(idx > i ? idx - 1 : idx);
  }
  selected.value = next;
};

const onInject = () => {
  const additions: PoolEntry[] = [];
  const replacements: { id: string; type: string; content: string }[] = [];
  for (const i of [...selected.value].sort((a, b) => a - b)) {
    const item = results.value[i];
    if (!item) continue;
    const type = item.type.trim();
    const content = item.content.trim();
    if (!type && !content) continue;
    if (item.replaceTargetId) {
      replacements.push({ id: item.replaceTargetId, type, content });
    } else {
      additions.push({
        id: uuidv4(),
        type,
        content,
        rule: '',
        pinned: false,
        weight: 1,
        category: targetCategory.value,
        condition: '',
      });
    }
  }
  if (!additions.length && !replacements.length) return;
  emit('confirm', { additions, replacements });
  emit('close');
};
</script>

<style scoped>
.choice-poolgen-overlay {
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

.choice-poolgen-dialog {
  width: 520px;
  max-width: 92vw;
  max-height: 85vh;
  margin: auto;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: inset 0 1px 0 var(--choice-frost-line), var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-poolgen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-poolgen-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-poolgen-close {
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

.choice-poolgen-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-poolgen-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
  padding: var(--choice-space-4);
  overflow-y: auto;
  flex: 1;
}

.choice-poolgen-form {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-poolgen-field {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-poolgen-field .text_pole {
  width: 100%;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-poolgen-field .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-poolgen-options {
  display: flex;
  align-items: flex-end;
  gap: var(--choice-space-3);
  flex-wrap: wrap;
}

.choice-poolgen-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  white-space: nowrap;
  margin-bottom: var(--choice-space-1);
}

.choice-poolgen-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  line-height: 1.4;
}

.choice-poolgen-actions {
  display: flex;
  gap: var(--choice-space-2);
}

.choice-poolgen-results {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-poolgen-results-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-poolgen-selall {
  font-size: var(--choice-text-xs);
}

.choice-poolgen-results-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-poolgen-result-row {
  display: flex;
  gap: var(--choice-space-2);
  align-items: flex-start;
  border-radius: var(--choice-space-1);
  padding: var(--choice-space-1);
}

.choice-poolgen-result-row.is-replace {
  border-left: var(--choice-space-1) solid var(--choice-text-hint);
  background: rgba(184, 148, 58, 0.06);
}

.choice-poolgen-result-row > input[type='checkbox'] {
  flex-shrink: 0;
  margin-top: var(--choice-space-2);
}

.choice-poolgen-index {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--choice-primary), var(--choice-primary-active));
  color: var(--choice-text-on-primary);
  font-size: var(--choice-text-xs);
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.choice-poolgen-result-main {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  flex: 1;
  min-width: 0;
}

.choice-poolgen-result-main .text_pole {
  flex: 1;
  min-width: 0;
  resize: vertical;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-poolgen-result-main .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-poolgen-replace-info {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-poolgen-replace-badge {
  color: var(--choice-text-hint);
  font-size: var(--choice-text-xs);
  font-weight: bold;
  border: 1px solid var(--choice-text-hint);
  border-radius: var(--choice-space-1);
  padding: 0 var(--choice-space-1);
  white-space: nowrap;
}

.choice-poolgen-orig {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.choice-poolgen-empty {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-2) 0;
}

.choice-poolgen-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding-top: var(--choice-space-3);
}

.choice-icon-btn {
  background: transparent;
  color: var(--choice-color-error);
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
  transition: background var(--choice-transition);
}

.choice-icon-btn:hover {
  background: var(--choice-bg-hover);
}
</style>
