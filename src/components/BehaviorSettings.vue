<template>
  <div class="choice-behavior-editor">
    <div class="choice-behavior-grid">
      <label class="choice-check">
        <input v-model="chatStore.settings.auto_generate" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`自动生成` }}
      </label>
      <label class="choice-check">
        <input v-model="globalStore.settings.ui.enrich_enabled" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`输入润色` }}
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

const chatStore = useChatSettingsStore();
const globalStore = useGlobalSettingsStore();
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
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
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
