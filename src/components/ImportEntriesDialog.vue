<template>
  <Teleport to="body">
    <div v-if="open" class="choice-importdlg-overlay" @click.self="emit('close')">
      <div class="choice-importdlg-dialog">
        <div class="choice-importdlg-header">
          <span class="choice-importdlg-title">
            <i class="fa-solid fa-paste"></i>
            {{ t`粘贴导入` }}
          </span>
          <div style="display: inline-flex; gap: 3px; align-items: center">
            <button
              ref="guideBtn"
              class="choice-importdlg-close"
              :title="t`页面指引`"
              @click="showGuide = !showGuide"
              style="font-size: var(--choice-text-sm)"
            >
              <i class="fa-solid fa-circle-question"></i>
            </button>
            <button class="choice-importdlg-close" :title="t`取消`" @click="emit('close')">&times;</button>
          </div>
        </div>

        <div class="choice-importdlg-body">
          <textarea
            v-model="rawText"
            class="text_pole choice-importdlg-textarea"
            rows="8"
            :placeholder="t`每行一条，支持 1. / - / • 等列表标记`"
          ></textarea>
          <div class="choice-importdlg-hint">
            {{ t`支持 1. / - / • 列表标记，自动去除。使用 ## 分组名 或 [分组名] 作为分组头。` }}
            <br />
            {{ t`行内标签（可选）：[固定] [权重:3] [条件:体力>50] 导入时自动剥离。` }}
          </div>

          <label v-if="!hasGroupHeaders" class="choice-field" style="margin-top: 10px">
            <span>{{ t`导入到分组` }}</span>
            <select v-model="targetCategory" class="text_pole">
              <option value="">{{ t`未分类` }}</option>
              <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </label>

          <div class="choice-importdlg-preview">
            <span class="choice-importdlg-preview-count">{{ t`解析结果` }}: {{ totalCount }} {{ t`条` }}</span>
            <div v-if="parsedGroups.length > 0" class="choice-importdlg-preview-list">
              <template v-for="(group, gi) in parsedGroups" :key="gi">
                <div class="choice-importdlg-preview-group">
                  <span class="choice-importdlg-preview-group-name">{{ group.category || t`未分组` }}</span>
                  <span class="choice-importdlg-preview-group-count">({{ group.entries.length }} {{ t`条` }})</span>
                </div>
                <div v-for="(entry, ei) in group.entries.slice(0, 3)" :key="ei" class="choice-importdlg-preview-item">
                  {{ getGlobalIndex(gi, ei) }}. {{ entry.type }}: {{ entry.content }}
                  <span v-if="entry.tags.pinned" class="choice-importdlg-tag">{{ t`固定` }}</span>
                  <span v-if="entry.tags.weight !== undefined" class="choice-importdlg-tag"
                    >{{ t`权重` }}:{{ entry.tags.weight }}</span
                  >
                  <span v-if="entry.tags.condition" class="choice-importdlg-tag"
                    >{{ t`条件` }}:{{ entry.tags.condition }}</span
                  >
                </div>
                <div v-if="group.entries.length > 3" class="choice-importdlg-preview-more">
                  ...{{ t`还有 ${group.entries.length - 3} 条` }}
                </div>
              </template>
            </div>
          </div>
        </div>

        <div class="choice-importdlg-footer">
          <button class="menu_button" @click="emit('close')">{{ t`取消` }}</button>
          <button class="menu_button menu_button_default" :disabled="totalCount === 0" @click="onConfirm">
            {{ t`确认导入` }}
          </button>
        </div>

        <GuidePopover
          :visible="showGuide"
          :anchor-el="guideBtn"
          icon="fa-solid fa-paste"
          title="粘贴导入"
          @close="showGuide = false"
        >
          <div v-html="guideHtml"></div>
        </GuidePopover>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import GuidePopover from '@/components/GuidePopover.vue';
import { GROUP_HEADER_RE, parsePoolEntries } from '@/core/pool-gen-parser';
import type { ParsedGroup } from '@/core/pool-gen-parser';

const props = defineProps<{
  open: boolean;
  categories: string[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [
    payload: {
      entries: { type: string; content: string; category: string; pinned?: boolean; weight?: number; condition?: string }[];
    },
  ];
}>();

const rawText = ref('');
const targetCategory = ref('');
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const guideHtml = `<p><strong>作用</strong>：从剪贴板批量导入条目，每行一条。支持 <code>1. / - / •</code> 等列表标记，自动去除标记符号和空行。</p>
<p><strong>分组标记</strong>：使用 <code>## 分组名</code> 或 <code>[分组名]</code> 独占一行作为分组头，后续条目归入该分组，直到下一个分组头。</p>
<p><strong>行内标签（可选）</strong>：在条目行内添加 <code>[固定]</code>、<code>[权重:N]</code>、<code>[条件:表达式]</code>，导入时自动识别并剥离。</p>
<p><strong>示例</strong>：<br><code>## 战斗<br>1. 拔出武器准备战斗 [固定] [权重:3]<br>- 防御姿态 [条件:体力>50]<br>[对话]<br>• 打招呼 [固定]<br>• 询问信息</code></p>
<p>以上将导入 4 条条目，2 条归入"战斗"（含固定/权重/条件），2 条归入"对话"。</p>`;

const hasGroupHeaders = computed(() => {
  if (!rawText.value.trim()) return false;
  return rawText.value.split(/\r?\n/).some(line => GROUP_HEADER_RE.test(line.trim()));
});

const parsedGroups = computed<ParsedGroup[]>(() => {
  return parsePoolEntries(rawText.value, hasGroupHeaders.value ? '' : targetCategory.value);
});

const totalCount = computed(() => parsedGroups.value.reduce((sum, g) => sum + g.entries.length, 0));

const getGlobalIndex = (gi: number, ei: number) => {
  let idx = 1;
  for (let i = 0; i < gi; i++) idx += parsedGroups.value[i].entries.length;
  return idx + ei;
};

const onConfirm = () => {
  const entries = parsedGroups.value.flatMap(g =>
    g.entries.map(e => ({
      type: e.type,
      content: e.content,
      category: g.category,
      pinned: e.tags.pinned,
      weight: e.tags.weight,
      condition: e.tags.condition,
    })),
  );
  emit('confirm', { entries });
  rawText.value = '';
  targetCategory.value = '';
};

watch(
  () => props.open,
  v => {
    if (!v) {
      rawText.value = '';
      targetCategory.value = '';
    }
  },
);
</script>

<style scoped>
.choice-importdlg-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--choice-z-dialog);
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  overflow-y: auto;
}

.choice-importdlg-dialog {
  width: 480px;
  max-width: 92vw;
  max-height: 85vh;
  margin: auto;
  background: var(--choice-bg-panel);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-importdlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(220, 140, 80, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-importdlg-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-importdlg-close {
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

.choice-importdlg-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-importdlg-body {
  overflow-y: auto;
  padding: var(--choice-space-4);
  flex: 1;
}

.choice-importdlg-textarea {
  width: 100%;
  resize: vertical;
  font-size: var(--choice-text-sm);
  line-height: 1.5;
}

.choice-importdlg-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  margin-top: var(--choice-space-1);
  line-height: 1.5;
}

.choice-importdlg-preview-group {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  margin-top: var(--choice-space-2);
  padding: var(--choice-space-1) 0;
  border-top: 1px solid var(--choice-border);
}

.choice-importdlg-preview-group:first-child {
  margin-top: 0;
  border-top: none;
}

.choice-importdlg-preview-group-name {
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-accent);
}

.choice-importdlg-preview-group-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-importdlg-tag {
  display: inline-block;
  font-size: var(--choice-text-xs);
  color: var(--choice-accent);
  background: var(--choice-bg-element);
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
  line-height: 1.4;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-importdlg-preview {
  margin-top: var(--choice-space-3);
  padding: var(--choice-space-3);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  border: 1px solid var(--choice-border);
}

.choice-importdlg-preview-count {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-importdlg-preview-list {
  margin-top: var(--choice-space-2);
}

.choice-importdlg-preview-item {
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-importdlg-preview-more {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  margin-top: 2px;
}

.choice-importdlg-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-3) var(--choice-space-4);
}
</style>
