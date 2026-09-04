<template>
  <div
    v-show="visible"
    ref="panelEl"
    class="choice-panel"
    :class="{
      'choice-panel--compact': compact,
      'choice-panel--dense': isDense,
      'choice-panel--docked': isDocked && !compact,
    }"
  >
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
        <!-- 面板状态锁：锁定后自动化（生成后展开/点选项收起/发消息收起）全部跳过，
             面板常开/常关；手动切换仍有效且锁定跟随新状态。持久化于 ui.panel_lock -->
        <button
          class="choice-panel-btn choice-panel-lock"
          :class="{ active: locked }"
          :title="locked ? t`解锁面板状态` : t`锁定面板状态（不再自动展开/收起）`"
          @click="onToggleLock"
        >
          <i :class="locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
        </button>
        <!-- 主题循环切换：每点一次切到 THEME_OPTIONS 中的下一个主题（末尾回绕）。
             全局生效并持久化（gs.settings.ui.theme_mode），tooltip 明示下一站避免盲切 -->
        <button class="choice-panel-btn choice-theme-cycle" :title="cycleTitle" @click="onCycleTheme">
          <i class="fa-solid fa-palette"></i>
        </button>
        <button
          class="choice-panel-btn"
          :title="collapsed ? t`展开` : t`收起`"
          @click="panelStore.setCollapsed(!collapsed)"
        >
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
          <button
            class="choice-behavior-btn"
            :class="{ active: behavior === 'insert' }"
            @click="behavior = 'insert'"
            :title="t`点击选项后插入到输入框光标处`"
          >
            <i class="fa-solid fa-i-cursor"></i>
            {{ t`插入` }}
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
          <div>{{ t`点击生成按钮获取选项` }}</div>
          <!-- API 未解析到时把空状态升级成解决入口：直达设置面板的 API 配置步 -->
          <button v-if="!apiReady" class="menu_button choice-panel-empty-action" @click="openApiOnboarding">
            <i class="fa-solid fa-plug"></i>
            {{ t`去配置 API` }}
          </button>
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
import toastr from 'toastr';
import { cancelGeneration, generateOptions, generatorState, resolveCustomApi } from '@/core/generator';
import { cancelEnrich } from '@/core/enrich-input';
import { storeGeneration } from '@/core/options-store';
import type { ChoiceOption } from '@/core/options-store';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { nextThemeMode, themeLabel } from '@/core/theme-presets';
import { useCompactLayout } from '@/components/shared/useCompactLayout';
import { openApiOnboarding, autoOpenApiOnboarding } from '@/core/onboarding';
import { sendTextareaMessage } from '@sillytavern/script';

const props = defineProps<{ compact?: boolean }>();

const panelEl = ref<HTMLElement | null>(null);
// 窄容器（手机聊天区 <420px）时收紧排版并限高滚动。与 compact prop 是两套机制：
// compact 是悬浮预览的极简形态（连头部管理件都省掉），dense 只压密度不减功能
const { isCompact: isDense } = useCompactLayout(panelEl);

const panelStore = usePanelStateStore();
const {
  messageId,
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

// 与 generateOptions 内部同一套 API 校验：口径一致（空状态按钮的显隐、生成的
// 前置拦截都看它），避免"按钮亮了但生成报未配置"的分裂
const apiReady = computed(() => !!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis));
const gs = useGlobalSettingsStore();

// 停靠模式：面板固定在输入框上方（settings.ui.panel_position = 'input'，挂载点由
// panel-mount 切换）。与 dense 正交——dense 由容器宽度触发只压排版，dock 由用户
// 设置触发换挂载点 + 展开限高；悬浮预览（compact）恒展开小卡，不参与 dock 限高
const isDocked = computed(() => gs.settings.ui.panel_position === 'input');

// 面板状态锁：锁定瞬间把当前展开/收起状态钉进 panel_lock（collapsed 来自 panelStore）；
// 锁定期间手动切换由 panel-state.setCollapsed 回写，此处只负责加锁/解锁
const locked = computed(() => gs.settings.ui.panel_lock !== 'off');
const onToggleLock = () => {
  gs.settings.ui.panel_lock = locked.value ? 'off' : collapsed.value ? 'collapsed' : 'open';
};

const behavior = computed({
  get: () => gs.settings.behavior,
  set: v => {
    gs.settings.behavior = v;
  },
});

// 主题循环：写入 ui.theme_mode 即全局生效并持久化（store 深度 watch 落盘 +
// watchEffect 同步 data-choice-theme 属性），整个扩展 UI 即时换色，无需刷新
const themeMode = computed(() => gs.settings.ui.theme_mode);
const cycleTitle = computed(() => {
  const next = nextThemeMode(themeMode.value);
  return t`切换主题（下一个：${themeLabel(next)}）`;
});
const onCycleTheme = () => {
  gs.settings.ui.theme_mode = nextThemeMode(themeMode.value);
};

// 面板挂在聊天流末尾，折叠态点展开时高度向下生长，底部常落在视口外（手机尤甚，
// 用户需上滑内容才能看到选项）。展开后把面板滚回可视区：block:'nearest' 只在
// 不可见时做最小滚动，不打扰正常浏览位置；不用默认 center——那会强行滚动所有
// 可滚祖先（SettingsPanel 的 tab 栏注释记录过同一问题）。收起不滚动。
// 双 rAF + 先做可见性预判：nextTick 后同帧仍有布局变化与未竟的程序滚动，
// 直接 smooth 会被打断而静默不滚（实测偶发），稳定一帧后再滚并只滚真正不可见的情形
watch(collapsed, v => {
  if (v) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = panelEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }),
  );
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
  // 前置拦截而非等 generateOptions 内部报错：API 未配置时请求注定失败，
  // 与其让用户看一条孤零零的 toastr，不如直接把设置面板+向导送到配置路径
  // （autoOpenApiOnboarding 每会话只自动弹一次，之后仅报错不再抢焦点）
  if (!apiReady.value) {
    toastr.error(t`请先在设置中配置 API（API 地址 + 模型）`);
    autoOpenApiOnboarding();
    return;
  }
  const target = { messageId: panelStore.messageId, swipeId: panelStore.swipeId };
  const generation = await generateOptions(target);
  if (!generation) {
    return;
  }
  storeGeneration(target.messageId, target.swipeId, generation);
  panelStore.load(target.messageId, target.swipeId);
  // 锁定收起时用户手动点生成，完成后仍保持收起（完全遵守锁定，无例外）
  panelStore.autoSetCollapsed(false);
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
const OPTION_TYPE_BRACKET_RE = /^[[【]([^\]】]+)[\]】]\s*/;

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
  if (behavior.value === 'insert') {
    // 光标处插入：selectionStart/End 保留点选项按钮（textarea 失焦）前的 caret 位置——
    // 浏览器规范行为，移动端同样适用。有选区时替换选区（标准文本插入），
    // 无选区时纯插入；空输入框或 caret 在末尾时等价尾附，无需特判。
    // textarea.value 的 setter 规范会把 caret 移到值末尾，故"从未手动聚焦"场景
    // 自然退化为末尾插入，不会把内容塞到开头。
    const el = $textarea[0] as HTMLTextAreaElement;
    const pos = el.selectionStart ?? String($textarea.val() ?? '').length;
    const end = el.selectionEnd ?? pos;
    const cur = String($textarea.val() ?? '');
    const next = cur.slice(0, pos) + content + cur.slice(end);
    $textarea.val(next)[0].dispatchEvent(new Event('input', { bubbles: true }));
    // 写值后 caret 会被重置，恢复到插入内容之后，方便用户接着编辑
    const caret = pos + content.length;
    try {
      el.focus();
      el.setSelectionRange(caret, caret);
    } catch {
      /* setSelectionRange 在极少数无 selection 的输入上可能抛错，忽略 */
    }
  } else if (behavior.value === 'append') {
    $textarea.val($textarea.val() + content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (behavior.value === 'send') {
    await sendTextareaMessage();
  }
  // 锁定展开时点选项后面板不收起（常开）
  panelStore.autoSetCollapsed(true);
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

/* 状态锁激活高亮：主色描边+文字，不加底色——与 behavior-btn.active 的实色主蓝区分，
   锁是"状态开关"而非"主操作"，视觉重量应低于生成按钮 */
.choice-panel-lock.active {
  color: var(--choice-primary);
  border-color: var(--choice-primary);
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
  /* 必须显式恢复 normal：停靠模式下面板挂在 #form_sheld 内，ST 对它声明了
     white-space:nowrap 并一路继承进选项文本——选项全部单行溢出，body 的
     overflow-x:auto 冒出横向滚动条（聊天内模式挂在 #chat 下无此继承，从未暴露）。
     需要 nowrap 的元素（behavior-btn/option-type）在下方均有显式声明，不受影响 */
  white-space: normal;
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

.choice-panel-empty-action {
  margin-top: var(--choice-space-2);
  font-size: var(--choice-text-sm);
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
  /* 列向 flex item 的 min-width:auto 会拿内容 min-content 当下限——长无空格 token
     （英文串/URL）会把按钮撑出容器宽，body 的 overflow-x:auto 顺势冒横向滚动条 */
  min-width: 0;
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
  /* anywhere（而非 break-word）：词内可断且参与 min-content 计算，flex 链条上
     每一级真正收窄——长英文 token/URL 在窄面板（停靠限高、手机 dense）里折行
     显示，而不是把按钮撑出横向滚动条 */
  overflow-wrap: anywhere;
}

/* 触屏触控目标：分页/生成/收起与行为切换是面板最高频点击点，窄高度按钮在手机上极难点中。
   pointer:coarse 只命中触屏主指针，桌面不受影响 */
@media (pointer: coarse) {
  .choice-panel-btn {
    min-height: var(--choice-tap-min);
    padding: var(--choice-space-2) var(--choice-space-3);
  }

  .choice-behavior-btn {
    min-height: var(--choice-tap-min);
  }
}

/* ===== 窄容器密度模式（useCompactLayout，<420px）=====
   只压密度不减功能：手机聊天区里 4 条选项 × 每条 2-4 行 + 头部 + 行为栏，展开常占半屏。
   收紧手段按收益排序：字号/行高（每行 -4px）、类型列 88→64px（给内容让宽、少折一行）、
   padding/间距、最后才是头部 padding。触控按钮保住 40px 最小可点高度（上一段规则），
   密度让给内容区而不是可点性。限高滚动只在此模式生效——桌面无高度压力，不引入嵌套滚动 */
.choice-panel--dense .choice-panel-header {
  padding: var(--choice-space-1) var(--choice-space-2);
}

.choice-panel--dense .choice-panel-body {
  /* 同 dvh 回退：手机上 vh 按布局视口取值，45vh 可能超出可视高度 */
  max-height: 45vh;
  max-height: 45dvh;
  overflow-y: auto;
  /* 触屏上面板内滚动到边缘时禁止滚动链传导，避免把酒馆聊天页一起拖走 */
  overscroll-behavior: contain;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2);
}

.choice-panel--dense .choice-option-btn {
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  line-height: 1.3;
}

.choice-panel--dense .choice-option-type {
  width: calc(64px * var(--choice-font-scale));
  font-size: calc(14px * var(--choice-font-scale));
}

.choice-panel--dense .choice-option-divider {
  margin-right: var(--choice-space-2);
}

.choice-panel--dense .choice-option-content {
  line-height: 1.3;
}

.choice-panel--dense .choice-panel-hint {
  padding-top: 0;
}

/* 抬头压缩：coarse 规则的 40px 触控高度 + 工具区满编（翻页/生成/调色板/收起）
   会把"行动选项"标题挤成两行，抬头反而更高。dense 下牺牲部分可点高度（40→32px）
   换单行抬头；特异性 (0,2,0) 高于 coarse 规则 (0,1,0)，无论书写顺序都由 dense 取胜 */
.choice-panel--dense .choice-panel-header {
  gap: var(--choice-space-1);
}

.choice-panel--dense .choice-panel-title {
  white-space: nowrap;
  font-size: var(--choice-text-sm);
}

.choice-panel--dense .choice-panel-btn {
  min-height: 32px;
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-xs);
}

.choice-panel--dense .choice-panel-pager {
  font-size: var(--choice-text-xs);
  margin: 0;
}

/* 行为栏：40px 按钮 + 容器 padding 使整条约 56px，小屏上与选项争高度；
   dense 下按钮 30px 把整条压到约 38px */
.choice-panel--dense .choice-behavior-btn {
  min-height: 30px;
  padding: 2px var(--choice-space-2);
  font-size: var(--choice-text-xs);
}

/* ===== 停靠模式（输入框上方，settings.ui.panel_position = 'input'）=====
   面板由 panel-mount 固定插在 #send_form 之前，脱离聊天流：楼层不被选项推走、
   面板不随聊天滚动。展开限高滚动是本模式的核心诉求——选项再多也不覆盖整屏，
   此封顶不分屏宽生效（dense 的 45dvh 仅窄容器命中），桌面同样限高。
   书写在 dense 块之后：手机停靠时 dense+dock 同时命中，由源码顺序让 dock 的
   40dvh 接管 body 限高。scrollIntoView 回位无需特判：停靠面板恒在可视区内，
   可见性预判自然短路 */
.choice-panel--docked {
  margin: var(--choice-space-1) var(--choice-space-2);
}

.choice-panel--docked .choice-panel-body {
  max-height: 40vh;
  max-height: 40dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>
