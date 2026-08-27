<template>
  <div v-show="visible" class="choice-panel" :class="{ 'choice-panel--compact': compact }">
    <div class="choice-panel-header" @click="panelStore.setCollapsed(!collapsed)">
      <span class="choice-panel-title" :class="{ 'choice-title--toggleable': hasEnrichHistory }" @click="onTitleClick">
        <i :class="activeView === 'enrich' ? 'fa-solid fa-pen-to-square' : 'fa-solid fa-chess'"></i>
        {{ activeView === 'enrich' ? t`输入润色` : t`行动选项` }}
        <i v-if="hasEnrichHistory" class="fa-solid fa-arrow-right-arrow-left choice-view-swap-icon"></i>
        <span v-if="hasEnrichHistory && activeView === 'options'" class="choice-view-badge">{{
          enrichGenerations.length
        }}</span>
      </span>
      <div class="choice-panel-tools" @click.stop>
        <!-- 选项视图分页 -->
        <template v-if="activeView === 'options' && hasHistory">
          <button class="choice-panel-btn" :disabled="currentIndex <= 0" title="上一组" @click="onPrev">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="choice-panel-pager">{{ currentIndex + 1 }}/{{ generations.length }}</span>
          <button
            class="choice-panel-btn"
            :disabled="currentIndex >= generations.length - 1"
            title="下一组"
            @click="onNext"
          >
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </template>
        <!-- 润色视图分页 -->
        <template v-if="activeView === 'enrich' && hasEnrichHistory">
          <button class="choice-panel-btn" :disabled="enrichCurrentIndex <= 0" title="上一组" @click="onEnrichPrev">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="choice-panel-pager">{{ enrichCurrentIndex + 1 }}/{{ enrichGenerations.length }}</span>
          <button
            class="choice-panel-btn"
            :disabled="enrichCurrentIndex >= enrichGenerations.length - 1"
            title="下一组"
            @click="onEnrichNext"
          >
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </template>
        <!-- 润色视图：取消（loading）按钮 -->
        <button
          v-if="activeView === 'enrich' && enrichLoading"
          class="choice-panel-btn choice-panel-main"
          @click="onCancelEnrich"
        >
          <i class="fa-solid fa-stop"></i>
          {{ t`取消` }}
        </button>
        <!-- 润色视图：生成润色按钮 -->
        <button
          v-if="activeView === 'enrich' && !enrichLoading"
          class="choice-panel-btn choice-panel-main"
          @click="onTriggerEnrich"
        >
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          {{ t`生成润色` }}
        </button>
        <!-- 选项视图：生成按钮 -->
        <button v-if="activeView === 'options'" class="choice-panel-btn choice-panel-main" @click="onToggle">
          <i v-if="isGenerating" class="fa-solid fa-stop"></i>
          <i v-else class="fa-solid fa-wand-magic-sparkles"></i>
          {{ isGenerating ? t`取消` : t`生成` }}
        </button>
        <button class="choice-panel-btn" :title="collapsed ? t`展开` : t`收起`" @click="panelStore.setCollapsed(!collapsed)">
          <i :class="collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up'"></i>
        </button>
      </div>
    </div>

    <div v-if="compact || !collapsed" class="choice-panel-body">
      <div v-if="enrichLoading" class="choice-panel-loading">
        <div class="choice-loading-bar"></div>
      </div>
      <div v-else-if="isGenerating" class="choice-panel-loading">
        <div class="choice-loading-bar"></div>
      </div>
      <template v-else-if="visibleOptions.length > 0">
        <div v-if="!compact" class="choice-behavior-bar">
          <button
            class="choice-behavior-btn"
            :class="{ active: behavior === 'send' }"
            @click="behavior = 'send'"
            :title="t`点击选项后发送消息`"
          >
            {{ t`发送` }}
          </button>
          <button
            class="choice-behavior-btn"
            :class="{ active: behavior === 'fill' }"
            @click="behavior = 'fill'"
            :title="t`点击选项后填入输入框`"
          >
            {{ t`覆盖` }}
          </button>
          <button
            class="choice-behavior-btn"
            :class="{ active: behavior === 'append' }"
            @click="behavior = 'append'"
            :title="t`点击选项后追加到输入框末尾`"
          >
            {{ t`尾附` }}
          </button>
        </div>
        <button
          v-for="(option, index) in visibleOptions"
          :key="index"
          class="choice-option-btn"
          @click="onSelect(option)"
        >
          <span class="choice-option-type">{{ parseOptionType(option.text) }}</span>
          <span class="choice-option-divider"></span>
          <span class="choice-option-content">{{ parseOptionContent(option.text) }}</span>
        </button>
        <div v-if="!compact && activeView === 'options' && underflow" class="choice-panel-hint">
          {{ t`本轮选项少于设定数量` }}
        </div>
      </template>
      <div v-else class="choice-panel-empty">
        <template v-if="activeView === 'enrich'">
          {{ t`点击"生成润色"按钮或在输入框中输入文字后点击润色图标` }}
        </template>
        <template v-else>
          {{ t`点击生成按钮获取选项` }}
        </template>
      </div>
      <div
        v-if="!compact && activeView === 'options' && !isGenerating && visibleOptions.length === 0"
        class="choice-panel-hint"
      >
        {{ t`生成前请确保已在设置中配置条目池和 API` }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cancelGeneration, generateOptions, generatorState } from '@/core/generator';
import { cancelEnrich } from '@/core/enrich-input';
import { storeGeneration } from '@/core/options-store';
import type { ChoiceOption } from '@/core/options-store';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { sendTextareaMessage } from '@sillytavern/script';

const props = defineProps<{ compact?: boolean }>();

const panelStore = usePanelStateStore();
const {
  messageId,
  swipeId,
  visibleOptions,
  currentIndex,
  generations,
  hasHistory,
  activeView,
  enrichLoading,
  enrichGenerations,
  enrichCurrentIndex,
  hasEnrichHistory,
  collapsed,
} = storeToRefs(panelStore);

const isGenerating = computed(() => generatorState.loading);
const gs = useGlobalSettingsStore();
const behavior = computed({
  get: () => gs.settings.behavior,
  set: v => {
    gs.settings.behavior = v;
  },
});

const visible = computed(() => {
  if (props.compact) {
    return true;
  }
  if (enrichLoading.value) {
    return true;
  }
  if (isGenerating.value) {
    return true;
  }
  return messageId.value !== null;
});

const underflow = computed(() => {
  const generation = panelStore.currentGeneration;
  return generation !== null && generation.count > generation.options.length;
});

const onToggle = async () => {
  if (isGenerating.value) {
    cancelGeneration();
    return;
  }
  if (panelStore.messageId === null) {
    return;
  }
  const target = { messageId: panelStore.messageId, swipeId: panelStore.swipeId };
  const generation = await generateOptions(target);
  if (!generation) {
    return;
  }
  storeGeneration(target.messageId, target.swipeId, generation);
  panelStore.load(target.messageId, target.swipeId);
  panelStore.setCollapsed(false);
};

const onCancelEnrich = () => {
  cancelEnrich();
  panelStore.enrichLoading = false;
  panelStore.setActiveView('options');
};

const onToggleView = () => {
  panelStore.setActiveView(panelStore.activeView === 'enrich' ? 'options' : 'enrich');
};

const onTitleClick = (e: MouseEvent) => {
  if (hasEnrichHistory.value) {
    e.stopPropagation();
    onToggleView();
  }
};

const onTriggerEnrich = () => {
  panelStore.triggerEnrichRequested = true;
};

const onPrev = () => {
  panelStore.goTo(panelStore.currentIndex - 1);
};

const onNext = () => {
  panelStore.goTo(panelStore.currentIndex + 1);
};

const onEnrichPrev = () => {
  panelStore.enrichGoTo(panelStore.enrichCurrentIndex - 1);
};

const onEnrichNext = () => {
  panelStore.enrichGoTo(panelStore.enrichCurrentIndex + 1);
};

// 分隔符：半角/全角冒号后跟任意空白字符，与 generator.ts 的 parseOptions 正则保持一致
const OPTION_SEP_RE = /[:：]\s/;

// 匹配开头的 [标题] 或 【标题】 模式，标题为括号内文字，括号后紧跟内容
const OPTION_TYPE_BRACKET_RE = /^[\[【]([^\]】]+)[\]】]\s*/;

const findOptionSep = (text: string): { idx: number; len: number } | null => {
  const m = text.match(OPTION_SEP_RE);
  return m ? { idx: m.index!, len: m[0].length } : null;
};

const parseOptionType = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return m[1].replace(/"/g, '');
  const sep = findOptionSep(text);
  return sep ? text.slice(0, sep.idx).replace(/"/g, '') : text.replace(/"/g, '');
};

const parseOptionContent = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return text.slice(m[0].length);
  const sep = findOptionSep(text);
  return sep ? text.slice(sep.idx + sep.len) : text;
};

const onSelect = async (option: ChoiceOption) => {
  let content: string;
  const m = option.text.match(OPTION_TYPE_BRACKET_RE);
  if (m) {
    content = option.text.slice(m[0].length);
  } else {
    const sep = findOptionSep(option.text);
    content = sep ? option.text.slice(sep.idx + sep.len) : option.text;
  }
  const $textarea = $('#send_textarea');
  if (behavior.value === 'append') {
    $textarea.val($textarea.val() + content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (behavior.value === 'send') {
    await sendTextareaMessage();
  }
  panelStore.setCollapsed(true);
};
</script>

<style scoped>
.choice-panel {
  display: flex;
  flex-direction: column;
  margin: var(--choice-space-2) var(--choice-space-3);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  background: var(--choice-bg-panel);
  overflow: hidden;
}

.choice-panel--compact {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

.choice-panel--compact .choice-option-btn {
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-1) var(--choice-space-2);
}

.choice-panel--compact .choice-option-type {
  font-size: calc(14px * var(--choice-font-scale));
  width: calc(72px * var(--choice-font-scale));
}

.choice-panel--compact .choice-option-content {
  line-height: 1.3;
}

/* 标题栏可切换状态：有润色结果时标题文字显示背景框+⇄图标，点击切换视图 */
.choice-title--toggleable {
  cursor: pointer;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: 2px var(--choice-space-2);
  transition:
    border-color var(--choice-transition),
    background var(--choice-transition);
}

.choice-title--toggleable:hover {
  border-color: var(--choice-border-active);
  background: var(--choice-bg-hover);
}

.choice-view-swap-icon {
  margin-left: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  transition: color var(--choice-transition);
}

.choice-title--toggleable:hover .choice-view-swap-icon {
  color: var(--choice-primary);
}

.choice-view-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  margin-left: 2px;
  border-radius: 8px;
  background: var(--choice-primary);
  color: var(--choice-text-on-primary);
  font-size: var(--choice-text-xs);
  font-weight: 700;
  line-height: 1;
}

.choice-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  border-bottom: 1px solid var(--choice-border-strong);
  cursor: pointer;
}

.choice-panel-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-panel-tools {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-panel-btn {
  background: var(--choice-bg-element);
  color: var(--choice-text);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  transition: background var(--choice-transition);
}

.choice-panel-btn:hover:not(:disabled) {
  background: var(--choice-bg-hover);
}

.choice-panel-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 主按钮弃用老式"渐变+发光"，改实色主蓝 + 磨砂高光，与暖白磨砂语言统一；
   color 必须显式覆盖父类的 --choice-text，否则蓝底上落暖黑字 */
.choice-panel-main {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
  color: var(--choice-text-on-primary);
  font-weight: bold;
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
}

.choice-panel-main:hover:not(:disabled) {
  background: var(--choice-primary-hover);
}

.choice-panel-pager {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  margin: 0 2px;
}

.choice-panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3) var(--choice-space-3);
}

.choice-panel-loading {
  flex: 1;
  display: flex;
  align-items: flex-end;
}

.choice-loading-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    var(--choice-bg-card) 0%,
    var(--choice-bg-card) 40%,
    rgba(var(--choice-primary-rgb), 0.2) 50%,
    var(--choice-bg-card) 60%,
    var(--choice-bg-card) 100%
  );
  background-size: 200% 100%;
  animation: choice-loading-shimmer 5s ease-in-out infinite;
}

@keyframes choice-loading-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.choice-panel-empty {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-1) 0;
}

.choice-panel-hint {
  color: var(--choice-text-hint);
  font-size: var(--choice-text-xs);
  padding-top: 2px;
}

.choice-behavior-bar {
  display: inline-flex;
  gap: 2px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-1);
}

.choice-behavior-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-full);
  padding: 2px var(--choice-space-3);
  font-size: var(--choice-text-xs);
  cursor: pointer;
  white-space: nowrap;
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
  color: var(--choice-text-on-primary);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
}

.choice-option-btn {
  display: flex;
  align-items: center;
  gap: 0;
  text-align: left;
  background: var(--choice-bg-card);
  color: var(--choice-text);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  padding: var(--choice-space-2) var(--choice-space-3);
  font-size: var(--choice-text-base);
  cursor: pointer;
  line-height: 1.4;
  transition:
    transform var(--choice-transition),
    border-color var(--choice-transition),
    box-shadow var(--choice-transition);
}

.choice-option-btn:hover {
  border-color: var(--choice-border-active);
  transform: translateY(-1px);
  box-shadow: var(--choice-shadow-md);
}

.choice-option-btn:active {
  transform: scale(0.985);
}

.choice-option-type {
  width: calc(88px * var(--choice-font-scale));
  flex-shrink: 0;
  font-weight: 700;
  font-size: calc(16px * var(--choice-font-scale));
  color: var(--choice-primary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.choice-option-divider {
  width: 1px;
  align-self: stretch;
  border-left: 1px dashed var(--choice-border-strong);
  flex-shrink: 0;
  margin-right: var(--choice-space-3);
}

.choice-option-content {
  flex: 1;
  min-width: 0;
  line-height: 1.4;
  font-size: var(--choice-text-base);
}
</style>
