<template>
  <div class="choice-appearance-editor">
    <div class="choice-appearance-section">
      <span class="choice-appearance-section-title">{{ t`面板` }}</span>
      <div class="choice-behavior-grid">
        <label class="choice-check">
          <input v-model="ui.floating_enabled" type="checkbox" />
          <span class="choice-check-custom"></span>
          <span class="choice-check-label">
            <strong>{{ t`悬浮窗` }}</strong>
            <small>{{ t`在屏幕右下角显示快捷按钮` }}</small>
          </span>
        </label>
      </div>
    </div>

    <div class="choice-appearance-section">
      <span class="choice-appearance-section-title">{{ t`输入润色` }}</span>
      <div class="choice-behavior-grid">
        <label class="choice-check">
          <input v-model="ui.enrich_enabled" type="checkbox" :title="t`在发送消息前用 AI 改写为多个润色版本`" />
          <span class="choice-check-custom"></span>
          <span class="choice-check-label">
            <strong>{{ t`启用输入润色` }}</strong>
            <small>{{ t`发送消息前用 AI 改写为多个润色版本` }}</small>
          </span>
        </label>
      </div>
      <div v-if="ui.enrich_enabled" class="choice-enrich-count">
        <span class="choice-appearance-label">{{ t`润色版本数` }}</span>
        <input v-model.number="ui.enrich_count" type="number" min="1" max="20" class="text_pole" style="width: 60px" />
        <span class="choice-field-hint">{{ t`（1-20）` }}</span>
      </div>
    </div>

    <div class="choice-appearance-section">
      <span class="choice-appearance-section-title">{{ t`主题` }}</span>
      <div class="choice-theme-switch">
        <button
          class="choice-theme-btn"
          :class="{ active: ui.theme === 'dark' }"
          :title="t`切换到暗色主题`"
          @click="ui.theme = 'dark'"
        >
          <i class="fa-solid fa-moon"></i>
          {{ t`暗色` }}
        </button>
        <button
          class="choice-theme-btn"
          :class="{ active: ui.theme === 'light' }"
          :title="t`切换到亮色主题`"
          @click="ui.theme = 'light'"
        >
          <i class="fa-solid fa-sun"></i>
          {{ t`亮色` }}
        </button>
      </div>
    </div>

    <div class="choice-appearance-section">
      <span class="choice-appearance-label"
        >{{ t`透明度` }} <span class="choice-appearance-value">{{ Math.round(ui.opacity * 100) }}%</span></span
      >
      <input v-model.number="ui.opacity" type="range" min="0.3" max="1" step="0.05" class="choice-opacity-slider" />
    </div>

    <div class="choice-appearance-section">
      <span class="choice-appearance-label">{{ t`字体大小` }}</span>
      <div class="choice-theme-switch">
        <button
          v-for="size in fontSizes"
          :key="size.value"
          class="choice-theme-btn"
          :class="{ active: ui.font_size === size.value }"
          :title="size.tip"
          @click="ui.font_size = size.value"
        >
          {{ size.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);

const fontSizes = [
  { value: 'small' as const, label: t`小`, tip: t`小号字体，适合紧凑布局` },
  { value: 'medium' as const, label: t`中`, tip: t`默认字体大小` },
  { value: 'large' as const, label: t`大`, tip: t`大号字体，方便阅读` },
];
</script>

<style scoped>
.choice-appearance-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-appearance-section {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-appearance-section-title {
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text);
  padding-bottom: 2px;
  border-bottom: 1px solid var(--choice-border);
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--choice-space-2);
}

.choice-check {
  display: flex;
  align-items: flex-start;
  gap: var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-3) var(--choice-space-3);
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

.choice-enrich-count {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
}

.choice-appearance-label {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-appearance-value {
  color: var(--choice-primary);
  font-weight: bold;
}

.choice-field-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
}

.choice-theme-switch {
  display: inline-flex;
  gap: 2px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-1);
}

.choice-theme-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-1) var(--choice-space-3);
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

.choice-theme-btn:hover {
  color: var(--choice-text-secondary);
}

.choice-theme-btn.active {
  background: var(--choice-primary);
  color: #fff;
  box-shadow: 0 0 8px var(--choice-primary-glow);
}

.choice-opacity-slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--choice-bg-element);
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  cursor: pointer;
}

.choice-opacity-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--choice-primary);
  border: 2px solid var(--choice-bg-panel);
  box-shadow: 0 0 8px var(--choice-primary-glow);
  cursor: pointer;
  transition: transform var(--choice-transition);
}

.choice-opacity-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.choice-opacity-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--choice-primary);
  border: 2px solid var(--choice-bg-panel);
  box-shadow: 0 0 8px var(--choice-primary-glow);
  cursor: pointer;
}
</style>
