<template>
  <div class="choice-appearance-editor">
    <!-- 悬浮窗分区：悬浮球开关 + 单击行为。data-tour 锚点挂在此区
         （引导 chapter 的 appearance-floating 步骤聚焦悬浮窗相关设置） -->
    <div class="choice-section" data-tour="appearance-floating">
      <h4 class="choice-section-title">{{ t`悬浮窗` }}</h4>
      <div class="choice-behavior-grid">
        <label class="choice-toggle">
          <input :checked="ui.floating_enabled" type="checkbox" @change="onEntryToggle('floating', $event)" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`悬浮窗` }}</strong>
            <small>{{ t`在屏幕右下角显示快捷按钮` }}</small>
          </span>
        </label>
      </div>
      <!-- 悬浮球单击行为：options=单击切换选项弹窗，settings=单击打开设置面板。
           右键/长按快捷菜单不受影响，两种模式下弹窗与设置都可达 -->
      <div class="choice-seg choice-position-switch">
        <button
          class="choice-seg-btn"
          :class="{ active: ui.bubble_click_action === 'options' }"
          :title="t`单击悬浮球呼出选项弹窗`"
          @click="ui.bubble_click_action = 'options'"
        >
          <i class="fa-solid fa-chess"></i>
          {{ t`单击出选项` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: ui.bubble_click_action === 'settings' }"
          :title="t`单击悬浮球打开设置面板（右键/长按仍可查看选项）`"
          @click="ui.bubble_click_action = 'settings'"
        >
          <i class="fa-solid fa-gear"></i>
          {{ t`单击出设置` }}
        </button>
      </div>
      <!-- 悬浮球样式：ring=现状环形；compact=紧凑小点（手机端更小、更不遮挡）。
           直径随样式联动（floating-state.bubbleSizeFor 单一来源） -->
      <div class="choice-seg choice-position-switch">
        <button
          class="choice-seg-btn"
          :class="{ active: ui.bubble_style === 'ring' }"
          :title="t`当前样式：环形（桌面 60 / 手机 48 px）`"
          @click="ui.bubble_style = 'ring'"
        >
          <i class="fa-solid fa-circle"></i>
          {{ t`环形` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: ui.bubble_style === 'compact' }"
          :title="t`紧凑小点（桌面 48 / 手机 40 px），削弱内环装饰，手机上更不遮挡`"
          @click="ui.bubble_style = 'compact'"
        >
          <i class="fa-solid fa-circle-dot"></i>
          {{ t`紧凑` }}
        </button>
      </div>
    </div>

    <!-- 聊天界面分区：聊天内选项面板 + 停靠位置 + 魔棒入口 -->
    <div class="choice-section">
      <h4 class="choice-section-title">{{ t`聊天界面` }}</h4>
      <div class="choice-behavior-grid">
        <label class="choice-toggle">
          <input :checked="ui.chat_panel_enabled" type="checkbox" @change="onEntryToggle('chat', $event)" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`选项面板` }}</strong>
            <small>{{ t`在聊天界面显示选项面板；关闭后改用悬浮球弹窗查看选项` }}</small>
          </span>
        </label>
        <label class="choice-toggle">
          <input v-model="ui.panel_collapse_on_outside_click" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`点击聊天正文收起` }}</strong>
            <small>{{ t`展开的面板在点击聊天正文/空白处时收起（点链接/按钮/输入框不触发）` }}</small>
          </span>
        </label>
        <label class="choice-toggle">
          <input :checked="ui.wand_menu_enabled" type="checkbox" @change="onEntryToggle('wand', $event)" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`魔棒菜单入口` }}</strong>
            <small>{{ t`在扩展程序（魔棒）菜单中显示行动选项入口` }}</small>
          </span>
        </label>
        <label class="choice-toggle">
          <input v-model="ui.hud_enabled" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`选项 HUD 化` }}</strong>
            <small>{{ t`分级色条（保守/平衡/大胆）/ 悬停增强 / 滑入动画 / 已选标记` }}</small>
          </span>
        </label>
      </div>
      <!-- 面板停靠位置：切换由 panel-mount 监听设置变更即时迁移挂载点。
           输入框上方 = 停靠模式，展开限高滚动，选项再多不覆盖整屏 -->
      <div class="choice-seg choice-position-switch">
        <button
          class="choice-seg-btn"
          :class="{ active: ui.panel_position === 'chat' }"
          :title="t`跟随最新楼层下方，随聊天滚动`"
          @click="ui.panel_position = 'chat'"
        >
          <i class="fa-solid fa-layer-group"></i>
          {{ t`聊天内` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: ui.panel_position === 'input' }"
          :title="t`固定在输入框上方，不随聊天滚动；展开限高滚动，选项再多不占满屏`"
          @click="ui.panel_position = 'input'"
        >
          <i class="fa-solid fa-anchor"></i>
          {{ t`输入框上方` }}
        </button>
      </div>
    </div>

    <!-- 高级功能分区：纯 UI 分层开关，独立成区——它是「设置页显示哪些 tab」的开关，
         不属于悬浮窗或聊天界面任一类别。appearance 是基础 tab，简化模式下它是
         重新开启高级 tab 的唯一入口，必须任何模式下都可达 -->
    <div class="choice-section">
      <h4 class="choice-section-title">{{ t`高级功能` }}</h4>
      <div class="choice-behavior-grid">
        <label class="choice-toggle">
          <input v-model="ui.advanced_features_enabled" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`显示进阶设置页` }}</strong>
            <small>{{ t`提示词、世界书、过滤、调试等设置页的显隐开关` }}</small>
          </span>
        </label>
      </div>
    </div>

    <div class="choice-section" data-tour="appearance-theme">
      <h4 class="choice-section-title">{{ t`主题` }}</h4>
      <div class="choice-seg">
        <button
          class="choice-seg-btn"
          :class="{ active: ui.theme_mode === 'auto' }"
          :title="t`自动检测酒馆主题（亮/暗）`"
          @click="ui.theme_mode = 'auto'"
        >
          <i class="fa-solid fa-magic"></i>
          {{ t`自动` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: ui.theme_mode === 'st' }"
          :title="t`完全跟随酒馆主题配色`"
          @click="ui.theme_mode = 'st'"
        >
          <i class="fa-solid fa-palette"></i>
          {{ t`跟随` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: ui.theme_mode === 'dark' }"
          :title="t`强制使用暗色主题`"
          @click="ui.theme_mode = 'dark'"
        >
          <i class="fa-solid fa-moon"></i>
          {{ t`暗色` }}
        </button>
        <button
          class="choice-seg-btn"
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
          class="choice-seg-btn"
          :class="{ active: ui.theme_mode === preset.id }"
          :title="t`切换到${preset.label}主题`"
          @click="ui.theme_mode = preset.id"
        >
          <span class="choice-theme-swatch" :style="{ background: preset.swatch }"></span>
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div class="choice-section">
      <h4 class="choice-section-title">{{ t`字体大小` }}</h4>
      <div class="choice-seg">
        <!-- 跟随设备：有效档在 global-settings 计算（触屏 small / 桌面 medium）。
             点具体档位即退出跟随并固定，此按钮用于回到自动——不加它，手机用户
             一旦点过档位就再也回不到"手机默认小字"的状态 -->
        <button
          class="choice-seg-btn"
          :class="{ active: ui.font_size_auto }"
          :title="t`跟随设备：触屏默认小号，桌面默认中号；选择具体档位后固定为该档`"
          @click="ui.font_size_auto = true"
        >
          {{ t`自动` }}
        </button>
        <button
          v-for="size in fontSizes"
          :key="size.value"
          class="choice-seg-btn"
          :class="{ active: !ui.font_size_auto && ui.font_size === size.value }"
          :title="size.tip"
          @click="onPickFontSize(size.value)"
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
import { setEntryVisible, type EntryKey } from '@/core/entry-points';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);

// 入口开关：v-model 直绑会绕过「至少保留一个入口」保底（可全关后插件无从找回），
// 改走 setEntryVisible 护栏——关掉最后一个时被拒绝并 toastr 提示
const onEntryToggle = (key: EntryKey, e: Event) => {
  setEntryVisible(key, (e.target as HTMLInputElement).checked);
};

// 预设主题按钮数据源：与面板循环按钮共用注册表，按 kind 过滤——
// 不能用 swatch 是否为空判断（语义过载），mode 档按钮由上方四个固定按钮承担
const THEME_PRESETS = THEME_OPTIONS.filter(t => t.kind === 'preset');

const fontSizes = [
  { value: 'small' as const, label: t`小`, tip: t`小号字体，适合紧凑布局` },
  { value: 'medium' as const, label: t`中`, tip: t`默认字体大小` },
  { value: 'large' as const, label: t`大`, tip: t`大号字体，方便阅读` },
];

// 点具体档位 = 退出"跟随设备"并固定（font_size_auto=false 后有效档不再读 matchMedia）
const onPickFontSize = (size: 'small' | 'medium' | 'large') => {
  ui.value.font_size = size;
  ui.value.font_size_auto = false;
};
</script>

<style scoped>
.choice-appearance-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--choice-space-2);
}

/* 面板位置切换条：与上方悬浮窗复选框拉开一行间距（复用主题分段按钮样式） */
.choice-position-switch {
  margin-top: var(--choice-space-2);
  flex-wrap: wrap;
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

/* 预设主题按钮的色点：颜色来自 THEME_OPTIONS.swatch（与 theme.css 主色手工同步），
   走 Vue :style 绑定而非写死 CSS——注册表增删主题时按钮无需改样式。
   分段容器/按钮本体走 global.css 的 .choice-seg/.choice-seg-btn 原子 */
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
