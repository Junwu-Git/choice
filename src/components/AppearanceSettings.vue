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
      <span class="choice-appearance-section-title">{{ t`主题` }}</span>
      <div class="choice-theme-switch">
        <button
          class="choice-theme-btn"
          :class="{ active: ui.theme_mode === 'auto' }"
          :title="t`自动检测酒馆主题（亮/暗）`"
          @click="ui.theme_mode = 'auto'"
        >
          <i class="fa-solid fa-magic"></i>
          {{ t`自动` }}
        </button>
        <button
          class="choice-theme-btn"
          :class="{ active: ui.theme_mode === 'st' }"
          :title="t`完全跟随酒馆主题配色`"
          @click="ui.theme_mode = 'st'"
        >
          <i class="fa-solid fa-palette"></i>
          {{ t`跟随` }}
        </button>
        <button
          class="choice-theme-btn"
          :class="{ active: ui.theme_mode === 'dark' }"
          :title="t`强制使用暗色主题`"
          @click="ui.theme_mode = 'dark'"
        >
          <i class="fa-solid fa-moon"></i>
          {{ t`暗色` }}
        </button>
        <button
          class="choice-theme-btn"
          :class="{ active: ui.theme_mode === 'light' }"
          :title="t`强制使用亮色主题`"
          @click="ui.theme_mode = 'light'"
        >
          <i class="fa-solid fa-sun"></i>
          {{ t`亮色` }}
        </button>
        <!-- 预设主题：独立完整 token 块（theme.css），与面板头部的循环切换按钮共用
             theme_mode 字段，此处的激活态随面板切换自动同步 -->
        <button
          v-for="preset in THEME_PRESETS"
          :key="preset.id"
          class="choice-theme-btn"
          :class="{ active: ui.theme_mode === preset.id }"
          :title="t`切换到${preset.label}主题`"
          @click="ui.theme_mode = preset.id"
        >
          <span class="choice-theme-swatch" :style="{ background: preset.swatch }"></span>
          {{ preset.label }}
        </button>
      </div>
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
import { THEME_OPTIONS } from '@/core/theme-presets';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);

// 预设主题按钮数据源：与面板循环按钮共用注册表，按 kind 过滤——
// 不能用 swatch 是否为空判断（语义过载），mode 档按钮由上方四个固定按钮承担
const THEME_PRESETS = THEME_OPTIONS.filter(t => t.kind === 'preset');

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
  color: var(--choice-text-on-primary);
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
  /* 8 个主题按钮单行放不下（窄面板尤甚），允许换行成两排 */
  flex-wrap: wrap;
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
  color: var(--choice-text-on-primary);
  box-shadow: 0 0 8px var(--choice-primary-glow);
}

/* 预设主题按钮的色点：颜色来自 THEME_OPTIONS.swatch（与 theme.css 主色手工同步），
   走 Vue :style 绑定而非写死 CSS——注册表增删主题时按钮无需改样式 */
.choice-theme-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.3);
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
