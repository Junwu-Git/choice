<template>
  <div class="choice-generation-editor">
    <div class="choice-generation-section">
      <div class="choice-generation-status">
        <span class="choice-config-status-label">{{ t`聊天级设置` }}</span>
        <span class="choice-field-hint">{{ t`仅对当前对话生效，切换聊天后恢复默认` }}</span>
      </div>
    </div>

    <div class="choice-generation-section">
      <label class="choice-check">
        <input v-model="chatStore.settings.auto_generate" type="checkbox" :title="t`开启后 AI 回复完自动生成选项`" />
        <span class="choice-check-custom"></span>
        <span class="choice-check-label">
          <strong>{{ t`自动生成` }}</strong>
          <small>{{ t`AI 回复完成后自动触发选项生成` }}</small>
        </span>
      </label>
    </div>

    <div class="choice-generation-section">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`点击行为` }}</label>
        </div>
        <small class="choice-field-hint">{{ t`点击选项按钮后的动作，与选项面板头部同步` }}</small>
      </div>
      <div class="choice-behavior-bar">
        <button
          class="choice-behavior-btn"
          :class="{ active: chatStore.settings.behavior === 'send' }"
          @click="chatStore.settings.behavior = 'send'"
          :title="t`点击选项后直接发送消息`"
        >
          <i class="fa-solid fa-paper-plane"></i>
          {{ t`发送` }}
        </button>
        <button
          class="choice-behavior-btn"
          :class="{ active: chatStore.settings.behavior === 'fill' }"
          @click="chatStore.settings.behavior = 'fill'"
          :title="t`点击选项后填入输入框（替换现有内容）`"
        >
          <i class="fa-solid fa-file-pen"></i>
          {{ t`覆盖` }}
        </button>
        <button
          class="choice-behavior-btn"
          :class="{ active: chatStore.settings.behavior === 'append' }"
          @click="chatStore.settings.behavior = 'append'"
          :title="t`点击选项后追加到输入框末尾`"
        >
          <i class="fa-solid fa-plus"></i>
          {{ t`尾附` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';

const chatStore = useChatSettingsStore();
</script>

<style scoped>
.choice-generation-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
}

.choice-generation-section {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-generation-status {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  font-size: var(--choice-text-xs);
}

.choice-config-status-label {
  font-weight: 600;
  color: var(--choice-primary);
  white-space: nowrap;
}

.choice-check {
  display: flex;
  align-items: flex-start;
  gap: var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-3);
  cursor: pointer;
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
  margin-top: 1px;
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
  font-size: var(--choice-text-xs);
  font-weight: bold;
  position: absolute;
  line-height: 1;
}

.choice-check-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--choice-text-secondary);
}

.choice-check-label strong {
  color: var(--choice-text);
}

.choice-check-label small {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-field-label {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-field-label label {
  font-weight: 600;
}

.choice-field-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  line-height: 1.4;
}

.choice-behavior-bar {
  display: flex;
  gap: 2px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-1);
  width: fit-content;
}

.choice-behavior-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-2) var(--choice-space-4);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  transition:
    background var(--choice-transition),
    color var(--choice-transition),
    box-shadow var(--choice-transition);
}

.choice-behavior-btn:hover {
  color: var(--choice-text-secondary);
}

.choice-behavior-btn.active {
  background: var(--choice-primary);
  color: #fff;
  box-shadow: 0 0 8px var(--choice-primary-glow);
}
</style>
