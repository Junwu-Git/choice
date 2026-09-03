<template>
  <Teleport to="body">
    <div v-if="isSettingsOpen" class="choice-floating-overlay" @click.self="onOverlayClick">
      <div
        ref="dialogEl"
        class="choice-floating-dialog"
        :class="{ 'choice-floating-dialog--dragging': isDragging }"
        :style="{
          '--choice-x': x + 'px',
          '--choice-y': y + 'px',
          width: dialogWidth + 'px',
          height: dialogHeight + 'px',
          transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        }"
      >
        <div class="choice-floating-header" ref="headerEl" data-tour="settings-header">
          <span class="choice-floating-title">
            <i class="fa-solid fa-chess"></i>
            {{ t`行动选项` }}
          </span>
          <button class="choice-floating-close" @click="closeSettings">&times;</button>
        </div>

        <div class="choice-floating-body choice-scrollbar">
          <div ref="tabsEl" class="choice-tabs" data-tour="tab-strip">
            <button
              v-for="tab in FLOATING_TABS"
              :key="tab.id"
              :ref="setTabBtnRef(tab.id)"
              class="choice-tab"
              :class="{ active: activeTab === tab.id }"
              @click="onTabClick(tab.id)"
            >
              <i :class="tab.icon"></i>
              {{ tab.label }}
            </button>
            <button
              ref="guideBtn"
              class="choice-tab choice-guide-btn"
              :title="t`页面指引`"
              @click="showGuide = !showGuide"
            >
              <i class="fa-solid fa-circle-question"></i>
            </button>
            <button class="choice-tab choice-guide-btn" :title="t`新手引导 / 功能课堂`" @click="openChapterMenu">
              <i class="fa-solid fa-graduation-cap"></i>
            </button>
          </div>

          <GuidePopover :visible="showGuide" :anchor-el="guideBtn" :hint="currentHint" @close="showGuide = false" />

          <PoolEditor v-if="activeTab === 'pool'" />
          <GenerationSettings v-else-if="activeTab === 'generation'" />
          <PromptEditor v-else-if="activeTab === 'prompt'" />
          <ApiEditor v-else-if="activeTab === 'api'" />
          <WorldInfoEditor v-else-if="activeTab === 'worldinfo'" />
          <FilterEditor v-else-if="activeTab === 'filter'" />
          <AppearanceSettings v-else-if="activeTab === 'appearance'" />
          <DebugSettings v-else-if="activeTab === 'debug'" />
        </div>

        <div class="choice-floating-resize" @mousedown="onResizeStart">
          <div class="choice-floating-resize-grip"></div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import ApiEditor from '@/components/ApiEditor.vue';
import AppearanceSettings from '@/components/AppearanceSettings.vue';
import GenerationSettings from '@/components/GenerationSettings.vue';
import PoolEditor from '@/components/PoolEditor.vue';
import PromptEditor from '@/components/PromptEditor.vue';
import FilterEditor from '@/components/FilterEditor.vue';
import WorldInfoEditor from '@/components/WorldInfoEditor.vue';
import GuidePopover from '@/components/GuidePopover.vue';
import DebugSettings from '@/components/DebugSettings.vue';
import { FLOATING_TABS, type TabId } from '@/components/shared/tab-definitions';
import { PAGE_HINTS } from '@/core/guide-content';
import { isSettingsOpen, closeSettings } from '@/core/floating-state';
import { maybeAutoOpenOnboarding, openChapterMenu, onboardingPendingTab } from '@/core/onboarding';

const activeTab = ref<TabId>('pool');
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const onTabClick = (id: TabId) => {
  // 兜底：抽屉/面板打开后引导仍未完成的场景，首次点 tab 也能触发自动弹出
  maybeAutoOpenOnboarding();
  activeTab.value = id;
};

// 面板打开瞬间触发首次自动弹出（向导实例挂在 FloatingRoot，全局单实例）；
// maybeAutoOpenOnboarding 内部自判 onboarding_done，重复调用无副作用
watch(isSettingsOpen, open => {
  if (open) maybeAutoOpenOnboarding();
});

// 向导「跳转到某 tab」：pendingTab 由打开中的面板消费后置回 null，
// 向导是全局单实例，不知道哪个面板开着，只能走这一层间接
watch(onboardingPendingTab, tab => {
  if (tab) {
    activeTab.value = tab;
    onboardingPendingTab.value = null;
  }
});

const currentHint = computed(() => PAGE_HINTS[activeTab.value]);

// 手机视口下 tab 栏横向滚动、滚动条被隐藏，溢出的激活 tab 需手动滚回可视区，
// 否则用户感知不到"后面还有 tab"
const tabsEl = ref<HTMLElement | null>(null);
const tabBtnEls = new Map<TabId, HTMLElement>();
const setTabBtnRef = (id: TabId) => (el: unknown) => {
  if (el instanceof HTMLElement) tabBtnEls.set(id, el);
};

const scrollActiveTabIntoStrip = () => {
  const strip = tabsEl.value;
  const btn = tabBtnEls.get(activeTab.value);
  if (!strip || !btn) return;
  // 用 getBoundingClientRect 计算相对位置而非 offsetLeft：strip 非 positioned，
  // offsetLeft 相对的 offsetParent 不一定是 strip；且禁用 scrollIntoView——
  // 它会把所有可滚祖先一起滚（含竖向），移动端反而可能把页面拖动
  const stripRect = strip.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const target = strip.scrollLeft + (btnRect.left - stripRect.left) - (strip.clientWidth - btnRect.width) / 2;
  strip.scrollLeft = Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
};

watch(activeTab, () => nextTick(scrollActiveTabIntoStrip));
// 弹窗 DOM 由 v-if 按需创建：每次打开 scrollLeft 归零，而组件实例整个页面生命周期只 mount 一次，
// onMounted 覆盖不到"重新打开"，必须监听开关注册补居中
watch(isSettingsOpen, open => {
  if (open) nextTick(scrollActiveTabIntoStrip);
});
onMounted(() => nextTick(scrollActiveTabIntoStrip));

// 手机首次打开近全屏：窄视口下 680x500 的桌面默认尺寸既放不下也没多少可视内容。
// 只影响无 localStorage 存档的首次打开；老用户已持久化的尺寸不动（打开时有 clamp 兜底）
const IS_NARROW_VIEWPORT = window.innerWidth < 720;
const defaultDialogWidth = IS_NARROW_VIEWPORT ? Math.round(window.innerWidth * 0.96) : 680;
const defaultDialogHeight = IS_NARROW_VIEWPORT ? Math.round(window.innerHeight * 0.9) : 500;
const posX = useStorage('choice_floating_settings_x', (window.innerWidth - defaultDialogWidth) / 2);
const posY = useStorage('choice_floating_settings_y', (window.innerHeight - defaultDialogHeight) / 2);
const dialogWidth = useStorage('choice_floating_settings_w', defaultDialogWidth);
const dialogHeight = useStorage('choice_floating_settings_h', defaultDialogHeight);

const dialogEl = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);

// 按住标题栏拖动、在弹窗外松手时，浏览器对按下/抬起目标不同的点击会在最近公共
// 祖先（恰好是 overlay 自身）派发 click，@click.self 会误判成"点了遮罩"把面板关掉
// （实测：拖完松手面板直接消失）。onEnd 先于该 click 触发，用时间戳挡掉松手后
// 一小段窗口内的遮罩点击；250ms 足够覆盖事件派发延迟，不影响正常点遮罩关闭
let dragJustEndedAt = 0;
const onOverlayClick = () => {
  if (Date.now() - dragJustEndedAt < 250) return;
  closeSettings();
};

const { x, y, isDragging } = useDraggable(dialogEl, {
  handle: headerEl,
  initialValue: { x: posX.value, y: posY.value },
  onEnd: ({ x, y }) => {
    posX.value = clampPanelX(x);
    posY.value = Math.max(0, Math.min(y, window.innerHeight - 100));
    dragJustEndedAt = Date.now();
  },
});

// 夹取边界按面板实际宽度计算：留 40px 保证面板主体可见，
// 否则窄窗口下 innerWidth-200 的旧公式会让 680px 宽的面板大半出界
function clampPanelX(x: number): number {
  const maxX = Math.max(0, window.innerWidth - dialogWidth.value + 40);
  return Math.max(0, Math.min(x, maxX));
}

// 面板坐标持久化在 localStorage，窗口缩小/换分辨率后可能整体落在视口外，
// 表现为"点击气泡后主界面不出现"。每次打开时先夹回可视区，并同步给 useDraggable
// （storage → posX 变化不会自动联动内部 x/y，必须手动写回）。
watch(isSettingsOpen, open => {
  if (!open) return;
  const nx = clampPanelX(posX.value);
  const ny = Math.max(0, Math.min(posY.value, window.innerHeight - 100));
  if (nx !== x.value) x.value = nx;
  if (ny !== y.value) y.value = ny;
  posX.value = nx;
  posY.value = ny;
});

let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;

const onResizeStart = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  resizeStartW = dialogWidth.value;
  resizeStartH = dialogHeight.value;
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
};

const onResizeMove = (e: MouseEvent) => {
  const dx = e.clientX - resizeStartX;
  const dy = e.clientY - resizeStartY;
  dialogWidth.value = Math.max(400, Math.min(window.innerWidth - 20, resizeStartW + dx));
  dialogHeight.value = Math.max(300, Math.min(window.innerHeight - 20, resizeStartH + dy));
};

const onResizeEnd = () => {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
};

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isSettingsOpen.value) {
    closeSettings();
  }
});
</script>

<style scoped>
.choice-floating-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  /* 同 dvh 回退：手机上 100vh 按布局视口取值，常大于扣掉地址栏/工具栏后的可视高度 */
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-floating);
  background: var(--choice-overlay);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  transition: opacity 0.25s ease-out;
}

.choice-floating-dialog {
  position: fixed;
  left: 0;
  top: 0;
  z-index: calc(var(--choice-z-floating) + 1);
  min-width: 400px;
  min-height: 300px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 20px);
  /* 同 dvh 回退：防止弹窗底部在手机上被系统栏顶出屏幕外 */
  max-height: calc(100dvh - 20px);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translate3d(var(--choice-x), var(--choice-y), 0);
}

.choice-floating-dialog--dragging {
  will-change: transform;
}

@media (max-width: 720px) {
  .choice-floating-dialog {
    width: 96vw;
    /* 行内 width（localStorage 持久化的 dialogWidth）优先级高于上面的 width 规则；
       且 min-width(400px) 与 max-width(100vw-20px) 在 <420px 视口冲突时 CSS 规定 min-width 胜出，
       两者叠加会导致窄屏（手机 WebView ~380px）下面板横向出界——必须放开 min-width，
       让 max-width 成为唯一收窄依据 */
    min-width: 0;
  }
}

.choice-floating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
  cursor: move;
  user-select: none;
}

.choice-floating-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-floating-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-floating-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-floating-body {
  overflow-y: auto;
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把弹窗背后的酒馆聊天页一起拖走 */
  overscroll-behavior: contain;
  padding: var(--choice-space-4);
  flex: 1;
}

.choice-tabs {
  display: inline-flex;
  gap: var(--choice-space-1);
  margin-bottom: var(--choice-space-3);
  /* 手机视口下 tab 溢出时必须在 tab 栏内部横向滚动：
     若不滚，手势会穿透到 .choice-floating-body（overflow-y:auto 隐式推出 overflow-x:auto），
     整个面板内容被横着划走；overscroll-behavior-x 再挡掉滚动到边缘后向页面链式传导 */
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}

.choice-tabs::-webkit-scrollbar {
  display: none;
}

.choice-tab {
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-2) var(--choice-space-4);
  font-size: var(--choice-text-xs);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  transition:
    background var(--choice-transition),
    color var(--choice-transition),
    box-shadow var(--choice-transition);
}

.choice-tab:hover {
  color: var(--choice-text);
  background: var(--choice-bg-hover);
}

.choice-tab.active {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
  color: var(--choice-text-on-primary);
  box-shadow: 0 0 10px var(--choice-primary-glow);
}

.choice-guide-btn {
  width: 32px;
  justify-content: center;
  padding: var(--choice-space-2) 0;
  font-size: var(--choice-text-base);
}

.choice-floating-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 22px;
  height: 22px;
  cursor: nwse-resize;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 0 5px 5px 0;
  user-select: none;
  z-index: 1;
}

.choice-floating-resize:hover .choice-floating-resize-grip {
  border-bottom-color: var(--choice-primary);
}

.choice-floating-resize-grip {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-bottom: 8px solid var(--choice-border-strong);
  transition: border-bottom-color var(--choice-transition);
}

/* ===== 触摸设备（手机）适配 =====
   以电容触屏为主指针时：角落缩放把手对近全屏面板无意义，隐藏以免误导；
   header 本体拖拽保留（pointer 事件实现，仍可微调位置，clamp 防出界）。
   tab 与关闭键是高频触控目标，抬到触控尺寸 */
@media (hover: none) and (pointer: coarse) {
  .choice-floating-resize {
    display: none;
  }

  .choice-tab {
    min-height: var(--choice-tap-min);
    padding: var(--choice-space-2) var(--choice-space-4);
  }

  .choice-floating-close {
    width: var(--choice-tap-min);
    height: var(--choice-tap-min);
  }
}

/* 手机（<480px 触屏）压缩顶部区：全尺寸头部(65px)+tab(44px) 在手机上吃掉近 1/6
   屏高。关闭键/tab 收到 32/34px 仍是可接受的触控目标；仅窄屏生效，平板触屏保持
   全尺寸（上-block 的选择器在此被更高特异性覆盖） */
@media (hover: none) and (pointer: coarse) and (max-width: 480px) {
  .choice-floating-header {
    padding: var(--choice-space-1) var(--choice-space-3);
  }

  .choice-floating-close {
    width: 32px;
    height: 32px;
  }

  .choice-tab {
    min-height: 34px;
    padding: var(--choice-space-1) var(--choice-space-3);
  }

  .choice-floating-body {
    padding: var(--choice-space-3);
  }
}
</style>
