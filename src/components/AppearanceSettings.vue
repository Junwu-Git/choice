<template>
  <div class="choice-appearance-editor">
    <PageGuide page-id="appearance-editor" icon="fa-solid fa-circle-info">
      <template #title>🎨 外观</template>
      <p>
        <strong>悬浮窗</strong
        >：在屏幕右下角显示一个快捷按钮，点击打开设置面板，拖动可改变位置。关闭后从设置面板入口进入。
      </p>
      <p><strong>主题</strong>：暗色/亮色切换，影响设置面板、选项面板等所有扩展 UI。</p>
      <p><strong>透明度</strong>：调整面板背景透明度，数值越低越透明。</p>
      <p><strong>字体大小</strong>：小/中/大三档，影响选项按钮和面板内的文字大小。</p>
    </PageGuide>

    <div class="choice-behavior-grid">
      <label class="choice-check">
        <input v-model="ui.floating_enabled" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`悬浮窗` }}
      </label>
    </div>

    <div class="choice-appearance-section">
      <span class="choice-appearance-label">{{ t`主题` }}</span>
      <div class="choice-theme-switch">
        <button class="choice-theme-btn" :class="{ active: ui.theme === 'dark' }" @click="ui.theme = 'dark'">
          <i class="fa-solid fa-moon"></i>
          {{ t`暗色` }}
        </button>
        <button class="choice-theme-btn" :class="{ active: ui.theme === 'light' }" @click="ui.theme = 'light'">
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
import PageGuide from '@/components/PageGuide.vue';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);

const fontSizes = [
  { value: 'small' as const, label: t`小` },
  { value: 'medium' as const, label: t`中` },
  { value: 'large' as const, label: t`大` },
];
</script>

<style scoped>
.choice-appearance-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr;
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

.choice-appearance-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choice-appearance-label {
  font-size: 12px;
  color: var(--choice-text-secondary);
}

.choice-appearance-value {
  color: var(--choice-primary);
  font-weight: bold;
}

.choice-theme-switch {
  display: inline-flex;
  gap: 2px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-full);
  padding: 3px;
}

.choice-theme-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-full);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
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
