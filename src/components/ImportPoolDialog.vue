<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="choice-cfdlg-overlay"
      @click.self="emit('close')"
    >
      <div class="choice-cfdlg-dialog">
        <div class="choice-cfdlg-header">
          <span class="choice-cfdlg-title">
            <i class="fa-solid fa-file-import"></i>
            {{ t`导入条目库` }}
          </span>
          <button
            class="choice-cfdlg-close"
            :title="t`取消`"
            @click="emit('close')"
          >
            &times;
          </button>
        </div>

        <div class="choice-cfdlg-body">
          <table class="import-dlg-info">
            <tr v-if="data?.fileName">
              <td class="import-dlg-label">{{ t`文件` }}</td>
              <td class="import-dlg-value">{{ data?.fileName }}</td>
            </tr>
            <tr v-if="data?.exportedAt">
              <td class="import-dlg-label">{{ t`导出时间` }}</td>
              <td class="import-dlg-value">{{ formatDate(data?.exportedAt) }}</td>
            </tr>
            <tr v-if="data?.partial">
              <td class="import-dlg-label">{{ t`范围` }}</td>
              <td class="import-dlg-value">{{ t`部分导出（仅勾选的条目）` }}</td>
            </tr>
            <tr>
              <td class="import-dlg-label">{{ t`条目数` }}</td>
              <td class="import-dlg-value">{{ (data?.master_pool ?? []).length }} {{ t`条` }}</td>
            </tr>
            <tr v-if="!data?.partial">
              <td class="import-dlg-label">{{ t`配置数` }}</td>
              <td class="import-dlg-value">{{ (data?.configs ?? []).length }} {{ t`个` }}</td>
            </tr>
            <tr>
              <td class="import-dlg-label">{{ t`分组数` }}</td>
              <td class="import-dlg-value">{{ (data?.group_order ?? []).length }} {{ t`个` }}</td>
            </tr>
          </table>

          <div class="import-dlg-mode">
            <label class="import-dlg-radio">
              <input v-model="mode" type="radio" value="merge" />
              <span>{{ t`合并到现有条目库` }}</span>
            </label>
            <label
              class="import-dlg-radio"
              :class="{ 'import-dlg-radio--disabled': data?.partial }"
              :title="data?.partial ? t`部分导出没有完整配置，仅支持合并` : ''"
            >
              <input v-model="mode" type="radio" value="replace" :disabled="data?.partial" />
              <span class="import-dlg-replace-label">{{ t`替换现有条目库（⚠ 不可撤销）` }}</span>
            </label>
          </div>
        </div>

        <div class="choice-cfdlg-footer">
          <button
            class="menu_button"
            @click="emit('close')"
          >
            {{ t`取消` }}
          </button>
          <button class="menu_button menu_button_default" @click="emit('confirm', mode)">
            {{ t`确认导入` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  data: {
    fileName: string;
    exportedAt: string;
    /** 部分导出标记：仅含勾选条目、无完整 configs——替换导入被禁用 */
    partial?: boolean;
    master_pool: any[];
    configs: any[];
    group_order: string[];
  } | null;
  /** 预选的导入模式：替换导入流程打开时预选 replace（合并导入不走预览，直接落库） */
  initialMode?: 'merge' | 'replace';
}>();

const emit = defineEmits<{
  close: [];
  confirm: [mode: 'merge' | 'replace'];
}>();

const mode = ref<'merge' | 'replace'>('merge');

watch(
  () => props.open,
  open => {
    if (open) mode.value = props.initialMode ?? 'merge';
  },
  { flush: 'post' },
);

const formatDate = (iso: string | undefined) => {
  if (!iso) return '';
  return iso.slice(0, 19).replace('T', ' ');
};
</script>

<style scoped>
.import-dlg-info {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--choice-space-3);
}

.import-dlg-label {
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
  width: 80px;
  vertical-align: top;
}

.import-dlg-value {
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.import-dlg-mode {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  margin-top: var(--choice-space-2);
  padding-top: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
}

.import-dlg-radio {
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

.import-dlg-radio:hover {
  background: var(--choice-bg-hover);
}

.import-dlg-radio--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.import-dlg-radio--disabled:hover {
  background: none;
}

.import-dlg-replace-label {
  color: var(--choice-warning, #e8a838);
}
</style>
