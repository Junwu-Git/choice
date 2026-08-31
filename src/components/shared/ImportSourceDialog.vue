<template>
  <ChoiceDialog :open="open" :title="title" icon="fa-solid fa-file-import" width="480px" @close="onClose">
    <div class="choice-importsrc-body">
      <button class="menu_button menu_button_default choice-importsrc-file-btn" @click="onPickFile">
        <i class="fa-solid fa-file-import"></i>
        {{ t`选择 JSON 文件…` }}
      </button>
      <div class="choice-importsrc-hint">
        {{
          pickedName
            ? t`已选择文件：${pickedName}，点下方「解析导入」`
            : t`若上方点击无反应（部分浏览器/套壳会限制文件选择器），可直接把导出的 JSON 文件内容原样粘贴到下面`
        }}
      </div>
      <textarea
        v-model="text"
        class="text_pole choice-importsrc-textarea"
        :placeholder="t`把 JSON 内容粘贴到这里（支持 Ctrl+V）`"
        rows="8"
        spellcheck="false"
      ></textarea>
      <div v-if="error" class="choice-importsrc-error">{{ error }}</div>
    </div>
    <template #footer>
      <button class="menu_button" @click="onClose">
        {{ t`取消` }}
      </button>
      <button class="menu_button menu_button_default" :disabled="!text.trim()" @click="onConfirm">
        {{ t`解析导入` }}
      </button>
    </template>
  </ChoiceDialog>
</template>

<script setup lang="ts">
// 导入源对话框：文件选择 + 粘贴文本双路径。
// 粘贴路径的存在是因为文件选择器在部分环境（Tauri 套壳/旧 WebView/被全局 CSS 隐藏的
// input）下点击毫无反应——粘贴不经过任何选择器，是兜底可用性最高的导入方式。
// 本组件只负责拿到「JSON 文本」，格式校验与落库由父级完成（失败时保持本弹窗打开，
// 用户粘贴的内容不丢失）。
import { ref, watch } from 'vue';
import ChoiceDialog from '@/components/shared/ChoiceDialog.vue';
import { pickJsonFile } from '@/util/file-picker';

const props = defineProps<{
  open: boolean;
  title: string;
  /** 解析/导入失败原因：红字显示在文本框下方，不随 toast 消失 */
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [{ text: string; fileName: string }];
}>();

const text = ref('');
const pickedName = ref('');

watch(
  () => props.open,
  open => {
    if (open) {
      text.value = '';
      pickedName.value = '';
    }
  },
);

const onPickFile = async () => {
  const file = await pickJsonFile();
  if (!file) return;
  text.value = await file.text();
  pickedName.value = file.name;
};

const onConfirm = () => {
  const content = text.value.trim();
  if (!content) return;
  emit('confirm', { text: content, fileName: pickedName.value || '粘贴内容' });
};

const onClose = () => emit('close');
</script>

<style scoped>
.choice-importsrc-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-importsrc-file-btn {
  width: 100%;
}

.choice-importsrc-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  line-height: 1.5;
}

.choice-importsrc-error {
  font-size: var(--choice-text-xs);
  color: var(--choice-color-error, #e5615e);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.choice-importsrc-textarea {
  width: 100%;
  font-family: monospace;
  font-size: var(--choice-text-xs);
  resize: vertical;
  min-height: 120px;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}
</style>
