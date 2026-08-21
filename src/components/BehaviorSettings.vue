<template>
  <div class="choice-behavior-editor">
    <label class="choice-field">
      <span>{{ t`选项数量模式` }}</span>
      <select v-model="generation.count_mode" class="text_pole">
        <option value="fixed4">{{ t`固定 4 个` }}</option>
        <option value="fixed6">{{ t`固定 6 个` }}</option>
        <option value="random4to8">{{ t`4-8 随机` }}</option>
      </select>
    </label>

    <label class="choice-check">
      <input v-model="chatStore.settings.auto_generate" type="checkbox" />
      {{ t`自动生成(主回复到达后)` }}
    </label>

    <label class="choice-field">
      <span>{{ t`选中选项后` }}</span>
      <select v-model="chatStore.settings.behavior" class="text_pole">
        <option value="send">{{ t`直接发送` }}</option>
        <option value="fill">{{ t`填入输入框待编辑` }}</option>
      </select>
    </label>

    <label class="choice-check">
      <input v-model="generation.categories_enabled" type="checkbox" />
      {{ t`分类多样性抽取` }}
    </label>

    <label class="choice-check">
      <input v-model="generation.shuffle_final" type="checkbox" />
      {{ t`送入提示词前洗牌最终结果` }}
    </label>

    <label class="choice-check">
      <input v-model="generation.pinned_follows_condition" type="checkbox" />
      {{ t`固定条目也遵守条件过滤` }}
    </label>

    <label class="choice-field">
      <span>{{ t`固定条目溢出策略` }}</span>
      <select v-model="generation.pinned_overflow" class="text_pole">
        <option value="send_all">{{ t`全部发出(可超过数量)` }}</option>
        <option value="trim">{{ t`截断到数量上限` }}</option>
      </select>
    </label>
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

const globalStore = useGlobalSettingsStore();
const chatStore = useChatSettingsStore();
const generation = globalStore.settings.generation;
</script>

<style scoped>
.choice-behavior-editor {
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

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #dcdcdc;
}
</style>
