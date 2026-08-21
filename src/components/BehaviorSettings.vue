<template>
  <div class="choice-behavior-editor">
    <div class="choice-behavior-row">
      <label class="choice-field">
        <span>{{ t`选项数量` }}</span>
        <input
          v-model="generation.count_mode"
          type="text"
          class="text_pole"
          placeholder="例: 4 或 4-8"
          style="width: 100%"
        />
      </label>
      <label class="choice-field">
        <span>{{ t`选中后` }}</span>
        <select v-model="chatStore.settings.behavior" class="text_pole">
          <option value="send">{{ t`发送` }}</option>
          <option value="fill">{{ t`覆盖` }}</option>
          <option value="append">{{ t`尾附` }}</option>
        </select>
      </label>
      <label class="choice-field">
        <span>{{ t`固定条目溢出` }}</span>
        <select v-model="generation.pinned_overflow" class="text_pole">
          <option value="send_all">{{ t`全部发出` }}</option>
          <option value="trim">{{ t`截断到上限` }}</option>
        </select>
      </label>
    </div>

    <div class="choice-behavior-grid">
      <label class="choice-check">
        <input v-model="chatStore.settings.auto_generate" type="checkbox" />
        {{ t`自动生成` }}
      </label>
      <label class="choice-check">
        <input v-model="generation.categories_enabled" type="checkbox" />
        {{ t`分类多样性` }}
      </label>
      <label class="choice-check">
        <input v-model="generation.shuffle_final" type="checkbox" />
        {{ t`最终洗牌` }}
      </label>
      <label class="choice-check">
        <input v-model="generation.pinned_follows_condition" type="checkbox" />
        {{ t`固定也过滤` }}
      </label>
    </div>
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

.choice-behavior-row {
  display: flex;
  gap: 10px;
}

.choice-behavior-row .choice-field {
  flex: 1;
  min-width: 0;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #dcdcdc;
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #dcdcdc;
  white-space: nowrap;
}
</style>