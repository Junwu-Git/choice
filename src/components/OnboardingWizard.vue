<template>
  <Teleport to="body">
    <template v-if="onboardingVisible">
      <!-- 无可聚焦目标时的整体调暗层；有目标时由 hole 的巨型 box-shadow 兼任调暗 -->
      <div v-if="!holeStyle" class="choice-tour-dim"></div>
      <div v-else class="choice-tour-hole" :style="holeStyle"></div>

      <div ref="cardEl" class="choice-tour-card" :class="{ 'is-centered': !holeStyle }" :style="cardStyle">
        <div class="choice-tour-progress">
          <span
            v-for="(s, i) in ONBOARDING_STEPS"
            :key="s.id"
            class="choice-tour-dot"
            :class="{ 'is-active': i === onboardingStepIndex, 'is-done': i < onboardingStepIndex }"
          ></span>
          <span class="choice-tour-progress-text">{{ onboardingStepIndex + 1 }} / {{ ONBOARDING_STEPS.length }}</span>
        </div>

        <div class="choice-tour-step-header">
          <i :class="step.icon"></i>
          <span>{{ step.title }}</span>
        </div>

        <div class="choice-tour-body choice-scrollbar">
          <div
            v-if="step.id === 'api-fill' || step.id === 'api-save'"
            class="choice-tour-status"
            :class="apiReady ? 'is-ok' : 'is-miss'"
          >
            <i :class="apiReady ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'"></i>
            <span>{{ apiReady ? t`API 已配置，可以正常生成` : t`尚未配置——完成本步前无法生成选项` }}</span>
          </div>
          <div v-else-if="step.id === 'pool-select'" class="choice-tour-status" :class="poolReady ? 'is-ok' : 'is-miss'">
            <i :class="poolReady ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'"></i>
            <span>{{ poolReady ? t`条目池就绪，可正常生成` : t`条目池为空——添加条目后才能生成选项` }}</span>
          </div>

          <div class="choice-tour-html" v-html="step.html"></div>
        </div>

        <!-- 完成反馈：本步内达成 → 即将自动前进；进入时已达成（重放）→ 提示手动下一步 -->
        <div v-if="doneHint" class="choice-tour-autoadvance">
          <i class="fa-solid fa-circle-check"></i>
          <span>{{ doneHint === 'auto' ? t`已完成，正在进入下一步…` : t`已完成，可直接点「下一步」` }}</span>
        </div>

        <div class="choice-tour-footer">
          <button class="menu_button choice-tour-skip" @click="closeOnboarding">{{ t`跳过引导` }}</button>
          <div class="choice-tour-footer-main">
            <button class="menu_button" :disabled="onboardingStepIndex === 0" @click="onboardingStepIndex--">
              {{ t`上一步` }}
            </button>
            <button class="menu_button menu_button_default" @click="onNext">
              {{ onboardingStepIndex === ONBOARDING_STEPS.length - 1 ? t`开始使用` : t`下一步` }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { resolveCustomApi } from '@/core/generator';
import {
  ONBOARDING_STEPS,
  onboardingStepIndex,
  onboardingVisible,
  onboardingPendingAction,
  closeOnboarding,
  requestOnboardingTab,
} from '@/core/onboarding';

const gs = useGlobalSettingsStore();
const poolStore = usePoolSelectorStore();

// 与真实生成入口同一套校验（generateOptions 内即用 resolveCustomApi 判 API 可用性），
// 徽章结论与用户实际点「生成」时的判定一致，避免"徽章亮了但仍生成失败"的口径分裂
const apiReady = computed(() => !!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis));
// effectivePool 已含 config 选择与回退逻辑（无配置时回退 master_pool），
// 非空即代表抽取算法拿得到素材
const poolReady = computed(() => poolStore.effectivePool.length > 0);

const step = computed(() => ONBOARDING_STEPS[onboardingStepIndex.value]);

const cardEl = ref<HTMLElement | null>(null);
const holeStyle = ref<Record<string, string> | null>(null);
const cardStyle = ref<Record<string, string>>({});

// ---- 完成信号引擎 ------------------------------------------------------
// done() 是普通函数（内部懒取 store），包成 computed 才能被 watch 追踪
const stepDone = computed(() => step.value.done?.() ?? null);
// 进入本步时的信号快照：仅当"基线 false → 运行中 true"（本步内从无到有）才自动前进。
// 全新档默认配置已含条目、老用户重放时 API 已配置——不区分基线会在进步瞬间秒跳。
// 用 ref 而非普通变量：完成提示文案需要随基线响应式渲染
const doneBaseline = ref<boolean | null>(null);
let autoAdvanceTimer: number | null = null;

const cancelAutoAdvance = () => {
  if (autoAdvanceTimer !== null) {
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
};

// 触发时机有讲究：保存 API 后徽章先亮 ✓，停 800ms 让用户看到反馈再翻页；
// 手动翻页/跳过/关闭随时可打断，定时器作废
watch(stepDone, v => {
  if (!onboardingVisible.value) return;
  cancelAutoAdvance();
  if (doneBaseline.value === false && v === true) {
    autoAdvanceTimer = window.setTimeout(() => {
      autoAdvanceTimer = null;
      onNext();
    }, 800);
  }
});

// null = 本步无信号不显示；'auto' = 本步内达成即将自动前进；'already' = 进入时已达成（重放）
const doneHint = computed<'auto' | 'already' | null>(() => {
  if (stepDone.value !== true) return null;
  return doneBaseline.value === false ? 'auto' : 'already';
});

const onNext = () => {
  cancelAutoAdvance();
  if (onboardingStepIndex.value >= ONBOARDING_STEPS.length - 1) {
    closeOnboarding();
  } else {
    onboardingStepIndex.value++;
  }
};

/** 逐级调整可滚祖先的 scrollTop/scrollLeft 把目标滚进可视区。
 *  不用 scrollIntoView——它会滚动所有可滚祖先（含聊天流本身），
 *  移动端会把整个页面拖走（SettingsPanel tab 栏注释记录过同一问题） */
const scrollIntoViewManual = (el: HTMLElement) => {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const canY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const canX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (canY || canX) {
      const r = el.getBoundingClientRect();
      const nr = node.getBoundingClientRect();
      if (canY) {
        const target = node.scrollTop + (r.top + r.height / 2 - (nr.top + node.clientHeight / 2));
        node.scrollTop = Math.max(0, Math.min(target, node.scrollHeight - node.clientHeight));
      }
      if (canX) {
        const target = node.scrollLeft + (r.left + r.width / 2 - (nr.left + node.clientWidth / 2));
        node.scrollLeft = Math.max(0, Math.min(target, node.scrollWidth - node.clientWidth));
      }
    }
    node = node.parentElement;
  }
};

/** 无锚点降级（run-generate 步 / 目标缺失）：放视口顶部居中而非垂直居中——
 *  生成步用户要点聊天页下方的「生成」按钮，卡片悬在中央正好挡住按钮区；
 *  顶部居中把底部完整让出来 */
const centeredCardStyle = (): Record<string, string> => ({
  left: '50%',
  top: '16px',
  width: `${Math.min(340, window.innerWidth - 16)}px`,
  transform: 'translateX(-50%)',
});

/**
 * 重算聚光灯与卡片位置。scroll=true 仅在步骤激活时传：每次激活把目标滚回可视区，
 * 之后的周期性同步只跟随不抢滚动——用户手动滚走目标时聚焦退化为居中卡片，
 * 滚回来自动恢复，不打架
 */
const syncPosition = (scroll: boolean) => {
  if (!onboardingVisible.value) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = ONBOARDING_STEPS[onboardingStepIndex.value];

  let el: HTMLElement | null = null;
  if (s.target) {
    const found = document.querySelector<HTMLElement>(s.target);
    // getClientRects 为空 = 处于 display:none 子树（tab 未激活等），视同不存在
    if (found && found.getClientRects().length > 0) el = found;
  }

  if (!el) {
    holeStyle.value = null;
    cardStyle.value = centeredCardStyle();
    return;
  }

  if (scroll) scrollIntoViewManual(el);
  const rect = el.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) {
    holeStyle.value = null;
    cardStyle.value = centeredCardStyle();
    return;
  }

  const pad = 6;
  const hLeft = Math.max(0, rect.left - pad);
  const hTop = Math.max(0, rect.top - pad);
  holeStyle.value = {
    left: `${hLeft}px`,
    top: `${hTop}px`,
    width: `${Math.min(vw, rect.right + pad) - hLeft}px`,
    height: `${Math.min(vh, rect.bottom + pad) - hTop}px`,
  };

  const cardW = Math.min(340, vw - 16);
  const cardH = cardEl.value?.offsetHeight ?? 260;
  const gap = 10;
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  // 优先放目标下方；下方放不下且上方空间更大时放上方；都放不下则钳回视口内（可能盖住目标，小屏兜底）
  let top: number;
  if (spaceBelow >= cardH + gap || spaceBelow >= spaceAbove) {
    top = rect.bottom + gap;
  } else {
    top = rect.top - gap - cardH;
  }
  top = Math.max(8, Math.min(top, vh - cardH - 8));
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 8));
  cardStyle.value = { left: `${left}px`, top: `${top}px`, width: `${cardW}px`, transform: 'none' };
};

/** 步骤激活链路：下发切 tab 信号 → 等 v-if 重挂载渲染 → 滚动并聚焦目标 */
const activateStep = async () => {
  if (!onboardingVisible.value) return;
  // 快照本步完成信号的初始状态（done 依赖 store，nextTick 前后值一致，
  // 直接同步快照即可）；同时清掉上一步可能遗留的自动前进计时器
  doneBaseline.value = stepDone.value;
  cancelAutoAdvance();
  const s = ONBOARDING_STEPS[onboardingStepIndex.value];
  if (s.tab) requestOnboardingTab(s.tab);
  // 自动开/关弹窗：条目库、选择条目、正则库的开关状态在 PoolEditor/FilterEditor
  // 本地，由它们 watch onboardingPendingAction 消费
  if (s.action) onboardingPendingAction.value = s.action;
  // 双 nextTick + rAF：pendingTab 被面板 watch 消费 → activeTab 变更 → tab 内容 v-if
  // 重挂载，rAF 后布局才稳定，此时查询 data-tour 目标才有几何信息
  await nextTick();
  await nextTick();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  syncPosition(true);
};

let syncTimer: number | null = null;
const onViewportChange = () => syncPosition(false);

watch(
  [onboardingVisible, onboardingStepIndex],
  () => {
    void activateStep();
  },
  { flush: 'post' },
);

// 面板拖动/内部滚动/窗口缩放不走 scroll/resize 的场景（拖拽用 transform）由
// 低频轮询兜底；聚焦跟随的成本可接受，向导非长驻 UI
watch(onboardingVisible, visible => {
  if (visible) {
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    syncTimer = window.setInterval(onViewportChange, 300);
  } else {
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    if (syncTimer !== null) {
      window.clearInterval(syncTimer);
      syncTimer = null;
    }
    cancelAutoAdvance();
    holeStyle.value = null;
  }
});

onUnmounted(() => {
  if (syncTimer !== null) window.clearInterval(syncTimer);
  cancelAutoAdvance();
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
});
</script>

<style scoped>
.choice-tour-dim {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  /* 同 dvh 回退：手机上 100vh 按布局视口取值，大于可视高度 */
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-popover);
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

/* 聚光灯挖洞：巨型 box-shadow 扩散盖住洞外一切，不依赖 clip-path（老内核安全）。
   覆盖层本身 pointer-events:none，洞内外的界面都保持可交互——引导不锁操作 */
.choice-tour-hole {
  position: fixed;
  z-index: var(--choice-z-popover);
  border-radius: var(--choice-radius-md);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  outline: 2px solid var(--choice-primary);
  outline-offset: 3px;
  pointer-events: none;
  transition:
    left 0.25s ease,
    top 0.25s ease,
    width 0.25s ease,
    height 0.25s ease;
}

.choice-tour-card {
  position: fixed;
  z-index: var(--choice-z-popover);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  padding: var(--choice-space-3) var(--choice-space-4);
  pointer-events: auto;
  max-height: calc(100vh - 16px);
  max-height: calc(100dvh - 16px);
}

.choice-tour-progress {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  margin-bottom: var(--choice-space-2);
  flex-shrink: 0;
}

.choice-tour-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
}

.choice-tour-dot.is-active {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
  box-shadow: 0 0 6px var(--choice-primary-glow);
}

.choice-tour-dot.is-done {
  background: var(--choice-border-strong);
  border-color: var(--choice-border-strong);
}

.choice-tour-progress-text {
  margin-left: auto;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-tour-step-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  margin-bottom: var(--choice-space-2);
  font-size: var(--choice-text-lg);
  font-weight: bold;
  color: var(--choice-text);
  flex-shrink: 0;
}

.choice-tour-step-header i {
  color: var(--choice-primary);
}

.choice-tour-body {
  overflow-y: auto;
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  line-height: 1.7;
}

.choice-tour-body :deep(strong) {
  color: var(--choice-text);
}

.choice-tour-html :deep(p) {
  margin: 0 0 var(--choice-space-2);
}

.choice-tour-html :deep(p:last-child) {
  margin-bottom: 0;
}

.choice-tour-status {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  border-radius: var(--choice-radius-md);
  margin-bottom: var(--choice-space-3);
  font-size: var(--choice-text-sm);
  border: 1px solid var(--choice-border);
}

.choice-tour-status.is-ok {
  color: var(--choice-primary);
  background: rgba(var(--choice-primary-rgb), 0.08);
}

.choice-tour-status.is-miss {
  color: var(--choice-warning);
  border-style: dashed;
  border-color: var(--choice-border-strong);
}

.choice-tour-autoadvance {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  margin-top: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  border-radius: var(--choice-radius-md);
  border: 1px solid var(--choice-primary);
  background: rgba(var(--choice-primary-rgb), 0.08);
  color: var(--choice-primary);
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
}

.choice-tour-footer {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  margin-top: var(--choice-space-3);
  flex-shrink: 0;
}

.choice-tour-skip {
  margin-right: auto;
}

.choice-tour-footer-main {
  display: flex;
  gap: var(--choice-space-2);
}
</style>
