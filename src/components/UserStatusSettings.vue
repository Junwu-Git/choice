<template>
  <div class="choice-status-settings">
    <div class="choice-status-settings-section">
      <label class="choice-status-setting-row">
        <input v-model="config.enabled" type="checkbox" class="choice-status-toggle" />
        <div class="choice-status-setting-info">
          <span class="choice-status-setting-label">{{ t`启用被动状态追踪` }}</span>
          <span class="choice-status-setting-desc">{{ t`开启后在聊天界面显示状态栏，AI 回复后自动提取 user 被动状态` }}</span>
        </div>
      </label>
    </div>

    <div v-if="config.enabled" class="choice-status-settings-section">
      <label class="choice-status-setting-row">
        <input v-model="config.auto_update" type="checkbox" class="choice-status-toggle" />
        <div class="choice-status-setting-info">
          <span class="choice-status-setting-label">{{ t`自动更新` }}</span>
          <span class="choice-status-setting-desc">{{ t`AI 回复后自动调用 API 从正文提取/更新状态（独立于选项自动生成）` }}</span>
        </div>
      </label>

      <label class="choice-status-setting-row">
        <input v-model="config.inject_enabled" type="checkbox" class="choice-status-toggle" />
        <div class="choice-status-setting-info">
          <span class="choice-status-setting-label">{{ t`注入正文 AI` }}</span>
          <span class="choice-status-setting-desc">{{ t`将当前状态作为提示词注入正文生成，让 AI 在写作时参考 user 的被动状态` }}</span>
        </div>
      </label>

      <div class="choice-status-setting-row choice-status-setting-row--field">
        <label class="choice-status-field-label">{{ t`注入深度` }}</label>
        <input
          v-model.number="config.injection_depth"
          class="text_pole choice-status-field-input"
          type="number"
          min="0"
          max="20"
        />
        <span class="choice-status-field-hint">{{ t`距聊天末尾的消息数，0=紧接末尾` }}</span>
      </div>

      <div class="choice-status-setting-row choice-status-setting-row--field">
        <label class="choice-status-field-label">{{ t`上下文轮数` }}</label>
        <input
          v-model.number="config.context_rounds"
          class="text_pole choice-status-field-input"
          type="number"
          min="0"
        />
        <span class="choice-status-field-hint">{{ t`状态更新时读取最近 N 轮正文` }}</span>
      </div>

      <div class="choice-status-setting-row choice-status-setting-row--field">
        <label class="choice-status-field-label">{{ t`状态条数上限` }}</label>
        <input
          v-model.number="config.max_entries"
          class="text_pole choice-status-field-input"
          type="number"
          min="1"
          max="20"
        />
        <span class="choice-status-field-hint">{{ t`新格式每轮约 5-10 条体感 + 唤起状态机，entries 超过上限时保留最新 N 条` }}</span>
      </div>
    </div>

    <div v-if="config.enabled" class="choice-status-settings-section">
      <button class="choice-status-danger-btn" @click="onClearAll">
        <i class="fa-solid fa-trash"></i>
        {{ t`清空当前状态` }}
      </button>
      <span class="choice-status-setting-desc">{{ t`清除最新楼层的所有状态条目（不影响历史楼层快照）` }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';
import { setMessageUserStatus, getLatestAiMessageId, refreshStatusInjection } from '@/core/status-tracker';
import { getMessageSwipeId } from '@/core/options-store';

const cs = useChatSettingsStore();
const config = computed(() => cs.settings.status_tracking);

// 配置变化时刷新正文注入（开关/深度变更需即时同步 extension_prompts）
watch(
  () => ({ ...config.value }),
  () => {
    refreshStatusInjection();
  },
  { deep: true },
);

function onClearAll() {
  const messageId = getLatestAiMessageId();
  if (messageId === null) return;
  const swipeId = getMessageSwipeId(messageId);
  setMessageUserStatus(messageId, swipeId, null);
  refreshStatusInjection();
}
</script>

<style scoped>
.choice-status-settings {
  padding: var(--choice-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-status-settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
  padding: var(--choice-space-3);
  border-radius: var(--choice-radius-md);
  background: var(--choice-surface);
  border: 1px solid var(--choice-border);
}

.choice-status-setting-row {
  display: flex;
  align-items: flex-start;
  gap: var(--choice-space-3);
  cursor: pointer;
}

.choice-status-setting-row--field {
  cursor: default;
  align-items: center;
  flex-wrap: wrap;
}

.choice-status-toggle {
  margin-top: 2px;
  flex-shrink: 0;
}

.choice-status-setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.choice-status-setting-label {
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text);
}

.choice-status-setting-desc {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-status-field-label {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  white-space: nowrap;
}

.choice-status-field-input {
  width: 80px;
  font-size: var(--choice-text-sm);
}

.choice-status-field-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-status-danger-btn {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  border: 1px solid var(--choice-color-error);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-color-error-bg);
  color: var(--choice-color-error);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  transition: background var(--choice-transition);
}

.choice-status-danger-btn:hover {
  background: rgba(224, 85, 85, 0.2);
}
</style>
