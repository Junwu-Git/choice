<template>
  <div v-show="visible" class="choice-panel">
    <div class="choice-panel-header">
      <span class="choice-panel-title">
        <i class="fa-solid fa-chess"></i>
        {{ t`行动选项` }}
      </span>
      <div class="choice-panel-tools">
        <template v-if="hasHistory">
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
        <button class="choice-panel-btn choice-panel-main" @click="onToggle">
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
      <div v-if="isGenerating" class="choice-panel-skeleton">
        <div class="choice-skeleton-item" style="width: 92%"></div>
        <div class="choice-skeleton-item" style="width: 78%"></div>
        <div class="choice-skeleton-item" style="width: 85%"></div>
      </div>
      <template v-else-if="visibleOptions.length > 0">
        <div class="choice-behavior-bar">
          <button class="choice-behavior-btn" :class="{ active: behavior === 'send' }" @click="behavior = 'send'">
            {{ t`发送` }}
          </button>
          <button class="choice-behavior-btn" :class="{ active: behavior === 'fill' }" @click="behavior = 'fill'">
            {{ t`覆盖` }}
          </button>
          <button class="choice-behavior-btn" :class="{ active: behavior === 'append' }" @click="behavior = 'append'">
            {{ t`尾附` }}
          </button>
        </div>
        <button
          v-for="(option, index) in visibleOptions"
          :key="index"
          class="choice-option-btn"
          @click="onSelect(option)"
        >
          <span class="choice-option-index">{{ index + 1 }}</span>
          {{ formatOptionDisplay(option.text) }}
        </button>
        <div v-if="underflow" class="choice-panel-hint">{{ t`本轮选项少于设定数量` }}</div>
      </template>
      <div v-else class="choice-panel-empty">{{ t`暂无选项,点击"生成"获取行动选项` }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cancelGeneration, generateOptions, generatorState } from '@/core/generator';
import { storeGeneration } from '@/core/options-store';
import type { ChoiceOption } from '@/core/options-store';
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { sendTextareaMessage } from '@sillytavern/script';

const panelStore = usePanelStateStore();
const { messageId, swipeId, visibleOptions, currentIndex, generations, hasHistory } = storeToRefs(panelStore);

const collapsed = ref(false);
const isGenerating = computed(() => generatorState.loading);
const chatStore = useChatSettingsStore();
const behavior = ref(chatStore.settings.behavior);
watch(behavior, v => {
  chatStore.settings.behavior = v;
});

const visible = computed(() => {
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

const onPrev = () => {
  panelStore.goTo(panelStore.currentIndex - 1);
};

const onNext = () => {
  panelStore.goTo(panelStore.currentIndex + 1);
};

const formatOptionDisplay = (text: string): string => {
  return text.replace(/"/g, '').replace(/: /, ' | ');
};

const onSelect = async (option: ChoiceOption) => {
  const content = option.text.includes(': ') ? option.text.slice(option.text.indexOf(': ') + 2) : option.text;
  const $textarea = $('#send_textarea');
  if (behavior.value === 'append') {
    $textarea.val($textarea.val() + content)[0].dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
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
}

.choice-panel-title {
  font-size: 14px;
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
  font-size: 12px;
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
  font-size: 12px;
  color: var(--choice-text-secondary);
  margin: 0 2px;
}

.choice-panel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px 10px;
}

.choice-panel-skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

.choice-skeleton-item {
  height: 38px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-sm);
  animation: choice-skeleton 1.5s ease-in-out infinite;
}

.choice-panel-empty {
  color: var(--choice-text-muted);
  font-size: 12px;
  padding: 4px 0;
}

.choice-panel-hint {
  color: var(--choice-text-hint);
  font-size: 11px;
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
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--choice-transition), color var(--choice-transition), box-shadow var(--choice-transition);
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
  gap: 10px;
  text-align: left;
  background: var(--choice-bg-card);
  color: var(--choice-text);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: 8px 10px;
  font-size: 13px;
  cursor: pointer;
  line-height: 1.4;
  transition: transform var(--choice-transition), border-color var(--choice-transition), box-shadow var(--choice-transition);
}

.choice-option-btn:hover {
  border-color: var(--choice-border-active);
  transform: translateY(-1px);
  box-shadow: var(--choice-shadow-md);
}

.choice-option-btn:active {
  transform: scale(0.985);
}

.choice-option-index {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--choice-primary), var(--choice-primary-active));
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>