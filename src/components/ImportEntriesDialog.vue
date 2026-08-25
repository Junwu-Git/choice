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
              style="font-size: 14px"
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

          <label class="choice-field" style="margin-top: 10px">
            <span>{{ t`导入到分组` }}</span>
            <select v-model="targetCategory" class="text_pole">
              <option value="">{{ t`未分类` }}</option>
              <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </label>

          <div class="choice-importdlg-preview">
            <span class="choice-importdlg-preview-count"
              >{{ t`解析结果` }}: {{ parsedEntries.length }} {{ t`条` }}</span
            >
            <div v-if="parsedEntries.length > 0" class="choice-importdlg-preview-list">
              <div v-for="(line, i) in parsedEntries.slice(0, 5)" :key="i" class="choice-importdlg-preview-item">
                {{ i + 1 }}. {{ line }}
              </div>
              <div v-if="parsedEntries.length > 5" class="choice-importdlg-preview-more">
                ...{{ t`还有 ${parsedEntries.length - 5} 条` }}
              </div>
            </div>
          </div>
        </div>

        <div class="choice-importdlg-footer">
          <button class="menu_button" @click="emit('close')">{{ t`取消` }}</button>
          <button class="menu_button menu_button_default" :disabled="parsedEntries.length === 0" @click="onConfirm">
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

const props = defineProps<{
  open: boolean;
  categories: string[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [payload: { category: string; entries: { text: string }[] }];
}>();

const rawText = ref('');
const targetCategory = ref('');
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const guideHtml = `<p><strong>作用</strong>：从剪贴板批量导入条目，每行一条。支持 <code>1. / - / •</code> 等列表标记，自动去除标记符号和空行。</p>
<p><strong>示例</strong>：粘贴以下内容即可导入 3 条条目：<br><code>1. 拔出武器准备战斗<br>- 转身逃跑<br>• 试图谈判</code></p>
<p><strong>导入到分组</strong>：选择目标分组，未选则放入"未分组"。</p>`;

const stripMarker = (l: string) => l.replace(/^\s*(?:\d+[.)、](?!\d)|[-•])\s*/, '').trim();

const parsedEntries = computed(() => {
  if (!rawText.value.trim()) return [];
  return rawText.value.split(/\r?\n/).map(stripMarker).filter(Boolean);
});

const onConfirm = () => {
  const entries = parsedEntries.value.map(t => ({ text: t }));
  emit('confirm', { category: targetCategory.value, entries });
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
  z-index: 10005;
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
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(220, 140, 80, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-importdlg-title {
  font-size: 14px;
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice-importdlg-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
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
  padding: 14px;
  flex: 1;
}

.choice-importdlg-textarea {
  width: 100%;
  resize: vertical;
  font-size: 13px;
  line-height: 1.5;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--choice-text-secondary);
}

.choice-importdlg-preview {
  margin-top: 10px;
  padding: 10px;
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  border: 1px solid var(--choice-border);
}

.choice-importdlg-preview-count {
  font-size: 12px;
  color: var(--choice-text-secondary);
}

.choice-importdlg-preview-list {
  margin-top: 6px;
}

.choice-importdlg-preview-item {
  font-size: 12px;
  color: var(--choice-text);
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-importdlg-preview-more {
  font-size: 11px;
  color: var(--choice-text-muted);
  margin-top: 2px;
}

.choice-importdlg-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  border-top: 1px solid var(--choice-border);
  padding: 10px 14px;
}
</style>
