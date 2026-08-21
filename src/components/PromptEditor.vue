<template>
  <div class="choice-prompt-editor">
    <label class="choice-field">
      <span>{{ t`行动选项 AI 人设` }}</span>
      <textarea
        v-model="rules.ai_persona"
        class="text_pole"
        rows="6"
        :placeholder="t`行动选项 AI 的身份与职责描述`"
      ></textarea>
    </label>
    <label class="choice-field">
      <span>{{ t`叙述人称` }}</span>
      <textarea
        v-model="rules.person"
        class="text_pole"
        rows="2"
        :placeholder="t`如:以第二人称叙述,贴合角色语气`"
      ></textarea>
    </label>
    <label class="choice-field">
      <span>{{ t`输出格式说明` }}</span>
      <textarea
        v-model="rules.output_format"
        class="text_pole"
        rows="2"
        :placeholder="t`如:每条选项以动词短语开头,简洁明了`"
      ></textarea>
    </label>
    <label class="choice-field">
      <span>{{ t`每条选项字数` }}</span>
      <input v-model.number="rules.option_length" class="text_pole" type="number" min="0" />
    </label>
    <label class="choice-field">
      <span>{{ t`额外要求` }}</span>
      <textarea
        v-model="rules.extra_requirements"
        class="text_pole"
        rows="3"
        :placeholder="t`可用占位符 {{count}} / {{pinned}} / {{pool_selected}}`"
      ></textarea>
    </label>
    <label class="choice-field">
      <span>{{ t`上下文轮数(0 = 全部历史)` }}</span>
      <input v-model.number="rules.context_rounds" class="text_pole" type="number" min="0" />
    </label>
    <div class="choice-hint">{{ t`一条 AI 回复 + 一条用户消息计为 1 轮` }}</div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';

const globalStore = useGlobalSettingsStore();
const rules = globalStore.settings.prompt_rules;
</script>

<style scoped>
.choice-prompt-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #dcdcdc;
}

.choice-hint {
  color: #9a9a9a;
  font-size: 11px;
}
</style>
