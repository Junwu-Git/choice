<template>
  <ChoiceDialog
    :open="open"
    :title="t`导入提示词模块`"
    icon="fa-solid fa-file-import"
    width="480px"
    @close="$emit('close')"
  >
    <table class="prompt-import-info">
      <tr v-if="summary?.fileName">
        <td class="prompt-import-label">{{ t`文件` }}</td>
        <td class="prompt-import-value">{{ summary.fileName }}</td>
      </tr>
      <tr>
        <td class="prompt-import-label">{{ t`导入范围` }}</td>
        <td class="prompt-import-value">{{ modeLabel }}</td>
      </tr>
      <tr>
        <td class="prompt-import-label">{{ t`覆盖现有` }}</td>
        <td class="prompt-import-value">{{ summary?.overwriteCount ?? 0 }} {{ t`个` }}</td>
      </tr>
      <tr>
        <td class="prompt-import-label">{{ t`新增` }}</td>
        <td class="prompt-import-value">{{ summary?.addCount ?? 0 }} {{ t`个` }}</td>
      </tr>
      <tr>
        <td class="prompt-import-label">{{ t`保留现有` }}</td>
        <td class="prompt-import-value">{{ summary?.keptCount ?? 0 }} {{ t`个` }}</td>
      </tr>
    </table>

    <div class="prompt-import-mode">
      <label class="prompt-import-radio">
        <input v-model="mode" type="radio" value="merge" />
        <span>{{ t`合并到现有模块（同 ID 覆盖内容，保留现有顺序）` }}</span>
      </label>
      <label class="prompt-import-radio">
        <input v-model="mode" type="radio" value="replace" />
        <span class="prompt-import-replace-label">{{ t`整体替换现有模块` }}</span>
      </label>
      <p v-if="mode === 'replace'" class="prompt-import-warning">
        {{ t`⚠ 整体替换将丢弃不在导入文件中的现有模块（含自建模块），不可撤销。` }}
      </p>
    </div>
  </ChoiceDialog>
</template>

<script setup lang="ts">
import ChoiceDialog from '@/components/shared/ChoiceDialog.vue';

const props = defineProps<{
  open: boolean;
  summary: {
    fileName: string;
    mode: 'all' | 'option' | 'enrich';
    overwriteCount: number;
    addCount: number;
    keptCount: number;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [mode: 'merge' | 'replace'];
}>();

// 默认合并：导入的常见意图是"套用别人的内容"，不该一键抹掉现有配置
const mode = ref<'merge' | 'replace'>('merge');

const modeLabel = computed(() => {
  switch (props.summary?.mode) {
    case 'option':
      return t`仅选项模块`;
    case 'enrich':
      return t`仅润色模块`;
    default:
      return t`全部模块`;
  }
});
</script>

<style scoped>
.prompt-import-info {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--choice-space-3);
}

.prompt-import-label {
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
  width: 90px;
  vertical-align: top;
}

.prompt-import-value {
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.prompt-import-mode {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  margin-top: var(--choice-space-2);
  padding-top: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
}

.prompt-import-radio {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  cursor: pointer;
  padding: var(--choice-space-1) var(--choice-space-2);
  border-radius: var(--choice-radius-sm);
  transition: background var(--choice-transition);
}

.prompt-import-radio:hover {
  background: var(--choice-bg-hover);
}

.prompt-import-replace-label {
  color: var(--choice-warning, #e8a838);
}

.prompt-import-warning {
  margin: 0;
  padding: 0 var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-warning, #e8a838);
}
</style>
