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
        <span class="choice-check-custom"></span>
        {{ t`自动生成` }}
      </label>
      <label class="choice-check">
        <input v-model="generation.categories_enabled" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`分类多样性` }}
      </label>
      <label class="choice-check">
        <input v-model="generation.shuffle_final" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`打乱选项顺序` }}
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { GenerationSettings } from '@/type/settings';

const poolSelector = usePoolSelectorStore();
const chatStore = useChatSettingsStore();
const generation = computed(() => poolSelector.effectiveConfig?.generation ?? GenerationSettings.prefault({}));
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
  color: var(--choice-text-secondary);
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  padding: 10px 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--choice-transition);
}

.choice-check:hover {
  background: var(--choice-bg-hover);
}

.choice-check input[type='checkbox'] {
  display: none;
}

.choice-check-custom {
  width: 16px;
  height: 16px;
  border: 1px solid var(--choice-border-strong);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--choice-transition), border-color var(--choice-transition);
  position: relative;
}

.choice-check input[type='checkbox']:checked + .choice-check-custom {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
}

.choice-check input[type='checkbox']:checked + .choice-check-custom::after {
  content: '✓';
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  position: absolute;
  line-height: 1;
}
</style>