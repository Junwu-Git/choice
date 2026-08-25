<template>
  <div v-show="visible" class="choice-panel">
    <div class="choice-panel-header" @click="collapsed = !collapsed">
      <span class="choice-panel-title">
        <i :class="enrichMode ? 'fa-solid fa-pen-to-square' : 'fa-solid fa-chess'"></i>
        {{ enrichMode ? t`输入润色` : t`行动选项` }}
      </span>
      <div class="choice-panel-tools" @click.stop>
        <template v-if="!enrichMode && hasHistory">
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
        <button v-if="enrichLoading" class="choice-panel-btn choice-panel-main" @click="onCancelEnrich">
          <i class="fa-solid fa-stop"></i>
          {{ t`取消` }}
        </button>
        <button
          v-if="enrichMode && !enrichLoading"
          class="choice-panel-btn"
          title="返回选项"
          @click="panelStore.exitEnrichMode()"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
        <button v-if="!enrichMode" class="choice-panel-btn choice-panel-main" @click="onToggle">
          <i v-if="isGenerating" class="fa-solid fa-stop"></i>
          <i v-else class="fa-solid fa-wand-magic-sparkles"></i>
          {{ isGenerating ? t`取消` : t`生成` }}
        </button>
        <button class="choice-panel-btn" :title="collapsed ? t`展开` : t`收起`" @click="collapsed = !collapsed">
          <i :class="collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up'"></i>
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="choice-panel-body">
      <div v-if="enrichLoading" class="choice-panel-loading">
        <span class="choice-loading-text">{{ t`正在润色…` }}</span>
        <div class="choice-loading-bar"></div>
      </div>
      <div v-else-if="isGenerating" class="choice-panel-loading">
        <span class="choice-loading-text">{{ t`正在生成选项…` }}</span>
        <div class="choice-loading-bar"></div>
      </div>
      <template v-else-if="visibleOptions.length > 0">
        <div class="choice-behavior-bar">
          <button class="choice-behavior-btn" :class="{ active: behavior === 'send' }" @click="behavior = 'send'" :title="t`点击选项后发送消息`">
            {{ t`发送` }}
          </button>
          <button class="choice-behavior-btn" :class="{ active: behavior === 'fill' }" @click="behavior = 'fill'" :title="t`点击选项后填入输入框`">
            {{ t`覆盖` }}
          </button>
          <button class="choice-behavior-btn" :class="{ active: behavior === 'append' }" @click="behavior = 'append'" :title="t`点击选项后追加到输入框末尾`">
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
        <div v-if="!enrichMode && underflow" class="choice-panel-hint">{{ t`本轮选项少于设定数量` }}</div>
      </template>
      <div v-else class="choice-panel-empty">
        {{ enrichMode ? t`暂无润色选项` : t`点击生成按钮获取选项` }}
      </div>
      <div v-if="!enrichMode && !isGenerating && visibleOptions.length === 0" class="choice-panel-hint">
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
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { sendTextareaMessage } from '@sillytavern/script';

const panelStore = usePanelStateStore();
const { messageId, swipeId, visibleOptions, currentIndex, generations, hasHistory, enrichMode, enrichLoading } =
  storeToRefs(panelStore);

const collapsed = ref(false);
const isGenerating = computed(() => generatorState.loading);
const chatStore = useChatSettingsStore();
const behavior = computed({
  get: () => chatStore.settings.behavior,
  set: (v) => { chatStore.settings.behavior = v; },
});

const visible = computed(() => {
  if (enrichMode.value) {
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
  collapsed.value = false;
};

const onCancelEnrich = () => {
  cancelEnrich();
  panelStore.exitEnrichMode();
};

const onPrev = () => {
  panelStore.goTo(panelStore.currentIndex - 1);
};

const onNext = () => {
  panelStore.goTo(panelStore.currentIndex + 1);
};

const parseOptionType = (text: string): string => {
  const idx = text.indexOf(': ');
  return idx !== -1 ? text.slice(0, idx).replace(/"/g, '') : text.replace(/"/g, '');
};

const parseOptionContent = (text: string): string => {
  const idx = text.indexOf(': ');
  return idx !== -1 ? text.slice(idx + 2) : text;
};

const onSelect = async (option: ChoiceOption) => {
  const content = option.text.includes(': ') ? option.text.slice(option.text.indexOf(': ') + 2) : option.text;
  const $textarea = $('#send_textarea');
  if (behavior.value === 'append') {
    $textarea.val($textarea.val() + content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (enrichMode.value) {
    panelStore.exitEnrichMode();
  }
  if (behavior.value === 'send') {
    await sendTextareaMessage();
  }
};
</script>

<style scoped>
.choice-panel {
  display: flex;
  flex-direction: column;
  margin: 8px 12px;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-panel);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  overflow: hidden;
}

.choice-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--choice-border-strong);
  cursor: pointer;
}

.choice-panel-title {
  font-size: calc(15px * var(--choice-font-scale));
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.choice-panel-tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.choice-panel-btn {
  background: var(--choice-bg-element);
  color: var(--choice-text);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  padding: 3px 8px;
  font-size: calc(13px * var(--choice-font-scale));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: background var(--choice-transition);
}

.choice-panel-btn:hover:not(:disabled) {
  background: var(--choice-bg-hover);
}

.choice-panel-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.choice-panel-main {
  background: linear-gradient(135deg, var(--choice-primary), var(--choice-primary-active));
  border-color: var(--choice-primary);
  font-weight: bold;
  box-shadow: 0 0 12px var(--choice-primary-glow);
}

.choice-panel-main:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--choice-primary-hover), var(--choice-primary));
}

.choice-panel-pager {
  font-size: calc(13px * var(--choice-font-scale));
  color: var(--choice-text-secondary);
  margin: 0 2px;
}

.choice-panel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px 10px;
}

.choice-panel-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
}

.choice-loading-text {
  font-size: calc(13px * var(--choice-font-scale));
  color: var(--choice-text-muted);
}

.choice-loading-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    var(--choice-bg-element) 0%,
    var(--choice-primary) 50%,
    var(--choice-bg-element) 100%
  );
  background-size: 200% 100%;
  animation: choice-shimmer 3s ease-in-out infinite;
}

.choice-panel-empty {
  color: var(--choice-text-muted);
  font-size: calc(13px * var(--choice-font-scale));
  padding: 4px 0;
}

.choice-panel-hint {
  color: var(--choice-text-hint);
  font-size: calc(12px * var(--choice-font-scale));
  padding-top: 2px;
}

.choice-behavior-bar {
  display: inline-flex;
  gap: 2px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-full);
  padding: 3px;
}

.choice-behavior-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-full);
  padding: 2px 10px;
  font-size: calc(12px * var(--choice-font-scale));
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
  color: #fff;
  box-shadow: 0 0 8px var(--choice-primary-glow);
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
  padding: 8px 10px;
  font-size: calc(15px * var(--choice-font-scale));
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
  margin-right: 10px;
}

.choice-option-content {
  flex: 1;
  min-width: 0;
  line-height: 1.4;
  font-size: calc(15px * var(--choice-font-scale));
}

@keyframes choice-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
