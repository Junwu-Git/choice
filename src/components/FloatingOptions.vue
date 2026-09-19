<template>
  <Teleport to="body">
    <div
      ref="popoverEl"
      class="choice-floating-options"
      :class="{ 'choice-floating-options--dimmed': dimmed, 'choice-floating-options--hud': hudEnabled }"
      :style="{
        '--choice-popover-x': popoverX + 'px',
        '--choice-popover-y': popoverY + 'px',
        '--choice-popover-width': popoverWidth + 'px',
      }"
      @pointerenter="dimmed = false"
      @pointerleave="onPointerLeave"
    >
      <!-- 选项列表：无标题栏的紧凑排版，每行「类型标签 + 内容」。
           生成中且无旧结果时显示加载占位，有旧结果则保留旧选项不闪烁（同主面板约定） -->
      <div class="choice-floating-options-body">
        <template v-if="options.length > 0">
          <button
            v-for="(option, index) in options"
            :key="`${generationId}:${index}`"
            class="choice-float-option"
            :class="optionBtnClass(option, index)"
            :style="optionBtnStyle(index)"
            @click="onSelect(option, index)"
          >
            <span class="choice-float-option-type">{{ parseOptionType(option.text) }}</span><!--
            --><span
              v-if="rateOf(option) !== null"
              class="choice-float-option-rate"
              :class="rateClass(rateOf(option)!)"
              >{{ rateOf(option) }}%</span
            ><!--
            --><span class="choice-float-option-content">{{ parseOptionContent(option.text) }}<i
              v-if="rollOf(index)"
              class="choice-float-roll-chip"
              :class="`choice-float-roll-chip--${rollOf(index)}`"
              >{{ rollLabel(rollOf(index)!) }}</i
            ></span>
          </button>
        </template>
        <div v-else-if="isGenerating" class="choice-floating-options-empty">
          <i class="fa-solid fa-spinner fa-spin"></i>
          {{ t`生成中…` }}
        </div>
        <div v-else class="choice-floating-options-empty">
          <div>{{ t`点击生成按钮获取选项` }}</div>
          <button v-if="!apiReady" class="menu_button choice-float-empty-action" @click="openApiOnboarding">
            <i class="fa-solid fa-plug"></i>
            {{ t`去配置 API` }}
          </button>
        </div>
      </div>

      <!-- 底部工具条：左端分页（仅多组结果时显示），右端锁/生成/设置 -->
      <div class="choice-floating-options-bar">
        <span v-if="generations.length > 1" class="choice-float-pager">
          <button class="choice-float-bar-btn" :disabled="currentIndex <= 0" :title="t`上一组`" @click="onPrev">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="choice-float-pager-text">{{ currentIndex + 1 }}/{{ generations.length }}</span>
          <button
            class="choice-float-bar-btn"
            :disabled="currentIndex >= generations.length - 1"
            :title="t`下一组`"
            @click="onNext"
          >
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </span>
        <span v-else class="choice-float-bar-spacer"></span>
        <!-- 生成/取消：主操作按钮放在锁的左侧，与聊天界面（ActionOptionsPanel）工具区
             生成→锁→设置的顺序保持一致 -->
        <button
          class="choice-float-bar-btn choice-float-bar-btn--main"
          :title="isGenerating ? t`取消生成` : t`生成选项`"
          @click="onToggle"
        >
          <i :class="isGenerating ? 'fa-solid fa-stop' : 'fa-solid fa-wand-magic-sparkles'"></i>
        </button>
        <!-- 锁：与全局 panel_lock 同源（off/open 二态），激活高亮；锁定时点选项弹窗不收起 -->
        <button
          class="choice-float-bar-btn"
          :class="{ 'choice-float-bar-btn--active': locked }"
          :title="locked ? t`解锁弹窗（点选项后收起）` : t`锁定弹窗（点选项后不收起）`"
          @click="onToggleLock"
        >
          <i :class="locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
        </button>
        <!-- 淡化开关：仅锁定 + 支持 hover 的设备显示（淡化只在锁定态、且鼠标移出选项栏
             时才生效）。开启时激活高亮，关闭则锁定态移出不淡化 -->
        <button
          v-if="locked && hoverable.matches"
          class="choice-float-bar-btn"
          :class="{ 'choice-float-bar-btn--active': dimEnabled }"
          :title="dimEnabled ? t`淡化已开启：锁定态移出选项栏变半透明` : t`淡化已关闭：锁定态移出不淡化`"
          @click="onToggleDim"
        >
          <i class="fa-solid fa-circle-half-stroke"></i>
        </button>
        <!-- 风险档位图例：HUD 开启且当前代存在带档位标注的选项时显示，紧贴设置按钮左侧 -->
        <span v-if="hasGradedOptions" class="choice-float-bar-legend" :title="legendTitle">
          <i class="fa-solid fa-circle-info"></i>
        </span>
        <button class="choice-float-bar-btn" :title="t`打开设置`" @click="openSettings">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { cancelGeneration, generateOptions, generatorState, resolveCustomApi } from '@/core/generator';
import { storeGeneration } from '@/core/options-store';
import type { ChoiceOption } from '@/core/options-store';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { openApiOnboarding, autoOpenApiOnboarding } from '@/core/onboarding';
import { openSettings, closeBubbleOptions, isSettingsOpen, bubbleX, bubbleY, bubbleSize } from '@/core/floating-state';
import { parseOptionType, parseOptionContent, parseOptionStyle, resolveOptionSuccessRate } from '@/util/option-format';
import { applyOptionBehavior } from '@/util/option-action';
import type { DiceOutcome } from '@/core/dice';

// 选项 popover 宽度：320px 封顶（放得下类型标签 + 内容），窄屏让给视口
const POPOVER_WIDTH = Math.min(320, window.innerWidth - 16);
// 与气泡之间的固定间隙（与 FloatingContextMenu 的 8px 一致）
const POPOVER_GAP = 8;

const popoverWidth = POPOVER_WIDTH;
const popoverEl = ref<HTMLElement | null>(null);
const dimmed = ref(false);

// 淡化反馈仅对真正支持 hover 的指针（鼠标）生效：pointerenter/pointerleave 在触屏上
// 语义不同——点按弹窗内选项也会先 enter、抬手后 leave，直接使用会导致手机上点完
// 选项后弹窗误判"移出"而残留半透明。MQL 常量在模块加载时求值，设备固定不变（同
// floating-state 的 isMobileBubble 做法）
const HOVERABLE_QUERY = '(hover: hover) and (pointer: fine)';
const hoverable = window.matchMedia(HOVERABLE_QUERY);

const onPointerLeave = () => {
  // 仅锁定 + 支持 hover + 用户开启淡化时才淡化；未锁定时移出不淡化
  // （未锁定外部点击本来就关闭弹窗，无需淡出反馈）
  if (locked.value && hoverable.matches && dimEnabled.value) {
    dimmed.value = true;
  }
};

const gs = useGlobalSettingsStore();
const panelStore = usePanelStateStore();

// 弹窗只读「行动选项」数据，不读润色视图（enrich）——聊天 UI 关闭时润色不可用，
// 弹窗定位为纯选项速选菜单。用 currentGeneration 而非 visibleOptions 是故意的：
// visibleOptions 会随 activeView 切到 enrich，弹窗没有润色概念，不应跟着变空
const options = computed(() => panelStore.currentGeneration?.options ?? []);
const currentIndex = computed(() => panelStore.currentIndex);
const generations = computed(() => panelStore.generations);

const isGenerating = computed(() => generatorState.loading);
const locked = computed(() => gs.settings.ui.panel_lock !== 'off');
const dimEnabled = computed(() => gs.settings.ui.floating_dim_enabled);

// 选项 HUD 化总开关（与主面板同源）：关闭时分级色条/悬停增强/滑入动画/已选打勾停用
const hudEnabled = computed(() => gs.settings.ui.hud_enabled);

// 已选打勾：同代内点过的选项加 ✓ 并半透明（纯视觉反馈，不持久化）。弹窗无润色视图，
// generationId 直接用当前选项代；key 用「generation id + 行号」避免跨代误标
const generationId = computed(() => panelStore.currentGeneration?.id ?? 'none');
const selectedKeys = ref<ReadonlySet<string>>(new Set());
const markOptionSelected = (index: number) => {
  const key = `${generationId.value}:${index}`;
  if (selectedKeys.value.has(key)) return;
  selectedKeys.value = new Set(selectedKeys.value).add(key);
};

const optionBtnClass = (option: ChoiceOption, index: number) => {
  if (!hudEnabled.value) return {};
  const grade = parseOptionStyle(option.text);
  return {
    'choice-float-option--conservative': grade === 'conservative',
    'choice-float-option--balanced': grade === 'balanced',
    'choice-float-option--bold': grade === 'bold',
    'choice-float-option--selected': selectedKeys.value.has(`${generationId.value}:${index}`),
  };
};

const optionBtnStyle = (index: number): Record<string, string> => {
  if (!hudEnabled.value) return {};
  return { animationDelay: `${index * 60}ms` };
};

// 骰子判定（v55）：成功率徽标与行内判定 chip 的总开关（独立于 HUD）。
// 徽标显示规则 = 骰子开 + 该选项可解析出成功率（AI 标注或档位兜底）
const diceEnabled = computed(() => gs.settings.dice.enabled);
const rateOf = (option: ChoiceOption): number | null =>
  diceEnabled.value ? resolveOptionSuccessRate(option.text) : null;
// 徽标语义色按把握分档：高（≥70）绿 / 中（40-69）蓝 / 低（<40）橙，
// 与成功率直觉一致（risk 色条表达的是风险档位，两者语义不同不混用）
const rateClass = (rate: number): string =>
  rate >= 70 ? 'choice-float-option-rate--high' : rate >= 40 ? 'choice-float-option-rate--mid' : 'choice-float-option-rate--low';

// 行内判定反馈：同代内点过的选项记一次判定结局（纯视觉，不持久化），
// key 用「generation id + 行号」，切代自然失效（同 selectedKeys 机制）
const rollResults = ref<ReadonlyMap<string, DiceOutcome>>(new Map());
const rollOf = (index: number): DiceOutcome | null =>
  rollResults.value.get(`${generationId.value}:${index}`) ?? null;
const rollLabel = (o: DiceOutcome): string =>
  o === 'crit_success' ? t`大成功` : o === 'crit_fail' ? t`大失败` : o === 'success' ? t`成功` : t`失败`;

const hasGradedOptions = computed(
  () => hudEnabled.value && options.value.some(o => parseOptionStyle(o.text) !== null),
);
const legendTitle = computed(() =>
  t`风险档位：保守（绿）/ 平衡（蓝）/ 大胆（橙）` + (diceEnabled.value ? t`；成功率徽标为骰子判定需求值` : ''),
);

// 关闭淡化瞬间若正处于半透明态，立即恢复不透明：避免"关了开关但弹窗还淡着"
watch(dimEnabled, enabled => {
  if (!enabled) dimmed.value = false;
});

const onToggleDim = () => {
  gs.settings.ui.floating_dim_enabled = !dimEnabled.value;
};

// 与 generateOptions 内部同一套 API 校验（口径同主面板，空态按钮显隐与生成前置拦截共用）
const apiReady = computed(() => !!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis));

const behavior = computed(() => gs.settings.behavior);

const onToggleLock = () => {
  // 弹窗没有「折叠」概念：锁只在 off/open 间切换（open=锁定常开=点选项不收起），
  // 与主面板共用 panel_lock 字段，两处激活态与语义实时同步
  gs.settings.ui.panel_lock = locked.value ? 'off' : 'open';
};

const onToggle = async () => {
  if (isGenerating.value) {
    cancelGeneration();
    return;
  }
  if (panelStore.messageId === null) {
    return;
  }
  // 前置拦截而非等 generateOptions 内部报错（同主面板 onToggle 口径）
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
  panelStore.autoSetCollapsed(false);
};

const onPrev = () => {
  panelStore.goTo(panelStore.currentIndex - 1);
};

const onNext = () => {
  panelStore.goTo(panelStore.currentIndex + 1);
};

const onSelect = async (option: ChoiceOption, index: number) => {
  // 弹窗是纯行动选项速选菜单（无润色视图），view 恒为 'options'，明确传入计价口径；
  // poolEntryIds/generationId 取被点选项所在代，供统计整轮归因与同代去重
  // （见 option-action.ts / core/stats.ts）
  const dice = await applyOptionBehavior(option, behavior.value, {
    view: 'options',
    poolEntryIds: panelStore.currentGeneration?.poolEntryIds ?? [],
    generationId: panelStore.currentGeneration?.id,
    matchedEntryId: option.matchedEntryId,
    scopeId: panelStore.currentGeneration?.scopeId,
  });
  // 行内判定 chip（v55 骰子结果，返回值非 null = 本次真的掷了骰）
  if (dice) {
    rollResults.value = new Map(rollResults.value).set(`${generationId.value}:${index}`, dice.outcome);
  }
  // 已选打勾（HUD 视觉反馈）：选中成功后才标记，与统计口径无关
  markOptionSelected(index);
  panelStore.autoSetCollapsed(true);
  // 锁定时点选项不收起（与主面板「锁定不被动收起」语义一致）；未锁定则选中即关
  if (!locked.value) {
    closeBubbleOptions();
  }
};

// 横向：优先放气泡右侧；右侧放不下（贴右边缘）翻到左侧；夹取在视口内。
// 竖向：锚定气泡上缘，但气泡若靠下导致弹出空间不足，上移让 popover 底部不越出
// 视口（用 55dvh 上限作高度估计，保证至少留 8px 边距）
const popoverX = computed(() => {
  const size = bubbleSize.value;
  const right = bubbleX.value + size + POPOVER_GAP;
  if (right + popoverWidth <= window.innerWidth) {
    return right;
  }
  return Math.max(8, bubbleX.value - popoverWidth - POPOVER_GAP);
});

const popoverY = computed(() => {
  const estHeight = Math.min(window.innerHeight * 0.55, window.innerHeight - 16);
  const maxTop = Math.max(8, window.innerHeight - estHeight - 8);
  return Math.max(8, Math.min(bubbleY.value, maxTop));
});

// 打开设置面板时关闭 popover：设置是全屏遮罩浮层，两者不该同时出现。
// 组件由 isBubbleOptionsOpen 的 v-if 控制挂载，本 watch 只在 popover 打开期间生效
watch(isSettingsOpen, open => {
  if (open) closeBubbleOptions();
});

// 未锁定时沿用文档级外部点击关闭；锁定后外部点击不关闭，也不触发淡化，
// 淡化仅由支持 hover 的鼠标移出选项栏触发（见 onPointerLeave）。Esc 同样不关闭。
// 刚挂载 300ms 内不响应同一手势的 pointerdown，popover 内点击也不关闭。
// 组件每次打开都重新挂载（v-if），openedAt 天然取到本次打开的时间
const openedAt = Date.now();
let cleanupDoc: (() => void) | null = null;

onMounted(() => {
  const handler = (e: PointerEvent) => {
    if (Date.now() - openedAt < 300) return;
    const target = e.target as HTMLElement;
    if (popoverEl.value?.contains(target)) return;
    if (target.closest('.choice-floating-bubble')) return;
    if (locked.value) return;
    closeBubbleOptions();
  };
  document.addEventListener('pointerdown', handler);
  cleanupDoc = () => document.removeEventListener('pointerdown', handler);
});

onUnmounted(() => {
  cleanupDoc?.();
});

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !locked.value) closeBubbleOptions();
});
</script>

<style scoped>
/* 选项 popover 外壳：fixed 定位在气泡旁，宽度/位置由 JS 计算（--choice-* 变量驱动）。
   独立 UI，不复用主面板（ActionOptionsPanel）的版式——这是速选菜单不是聊天内面板 */
.choice-floating-options {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--choice-z-popover);
  transform: translate3d(var(--choice-popover-x), var(--choice-popover-y), 0);
  width: var(--choice-popover-width);
  max-width: calc(100vw - 16px);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  opacity: 1;
  transition: opacity 0.2s ease;
}

.choice-floating-options--dimmed {
  opacity: 0.45;
}

/* 选项区：限高内部滚动；触屏允许纵向平移，到顶/底后滚动链不传导给聊天页
   （与主面板 body 的分轴约定一致） */
.choice-floating-options-body {
  max-height: 55vh;
  max-height: 55dvh;
  overflow-y: auto;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: var(--choice-border-strong) transparent;
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2);
}

/* 选项行：整行可点，type 徽标与内容处于同一文本流（非 flex 两列）——
   type 不再单独占左侧列宽，随文字自适应并紧贴内容，长内容可断行 */
.choice-float-option {
  display: block;
  text-align: left;
  background: var(--choice-bg-card);
  color: var(--choice-text);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  line-height: 1.4;
  min-width: 0;
  /* HUD 分级色条（::before 左缘）与悬停箭头（::after）的定位基准 */
  position: relative;
  transition:
    transform var(--choice-transition),
    border-color var(--choice-transition),
    box-shadow var(--choice-transition);
}

/* 左缘分级色条：透明占位（width 过渡不跳变），--hud 门控下按档位上色（同主面板约定） */
.choice-float-option::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: var(--choice-radius-sm) 0 0 var(--choice-radius-sm);
  background: transparent;
  transition:
    background var(--choice-transition),
    width var(--choice-transition);
}

/* 悬停箭头：绝对定位在行尾，hover 才浮现（不占布局） */
.choice-float-option::after {
  content: '›';
  position: absolute;
  right: var(--choice-space-2);
  top: 50%;
  transform: translateY(-50%) translateX(4px);
  font-weight: 700;
  color: var(--choice-primary);
  opacity: 0;
  transition:
    opacity var(--choice-transition),
    transform var(--choice-transition);
}

.choice-float-option:hover {
  border-color: var(--choice-border-active);
  transform: translateY(-1px);
  box-shadow: var(--choice-shadow-md);
}

.choice-float-option:active {
  transform: scale(0.985);
}

/* ===== 选项 HUD 化（ui.hud_enabled，--hud 类整体门控，同主面板约定）===== */
.choice-floating-options--hud .choice-float-option {
  animation: choice-option-enter 220ms ease-out both;
}

@keyframes choice-option-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.choice-floating-options--hud .choice-float-option--conservative::before {
  background: var(--choice-risk-conservative);
}

.choice-floating-options--hud .choice-float-option--balanced::before {
  background: var(--choice-risk-balanced);
}

.choice-floating-options--hud .choice-float-option--bold::before {
  background: var(--choice-risk-bold);
}

.choice-floating-options--hud .choice-float-option:hover {
  transform: translateY(-2px);
  box-shadow:
    var(--choice-shadow-md),
    inset 0 1px 0 var(--choice-frost-line);
}

.choice-floating-options--hud .choice-float-option:hover::before {
  width: 5px;
}

.choice-floating-options--hud .choice-float-option:hover::after {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

/* 已选打勾：同代内点过的选项降透明度 + 虚线描边 + 类型徽标前 ✓ */
.choice-floating-options--hud .choice-float-option--selected {
  opacity: 0.55;
  border-style: dashed;
}

.choice-floating-options--hud .choice-float-option--selected .choice-float-option-type::before {
  content: '✓';
  margin-right: 3px;
  color: var(--choice-color-success);
  font-weight: 700;
}

/* 风险档位图例（底部工具条，设置按钮左侧）：muted 图标 + hover 主色 */
.choice-float-bar-legend {
  padding: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  cursor: help;
}

.choice-float-bar-legend:hover {
  color: var(--choice-primary);
}

/* 动画尊重系统减弱动态偏好：关闭逐条滑入，其余 HUD 样式保留 */
@media (prefers-reduced-motion: reduce) {
  .choice-floating-options--hud .choice-float-option {
    animation: none;
  }
}

/* 类型徽标：行内块（inline-flex）紧贴内容，宽度随文字自适应，不占独立列——
   类型完整显示不截断（长就长）；字号与内容同号（text-sm），仅靠字重+色相区分；
   行高与内容统一（1.4）保证同行中对中不偏下 */
.choice-float-option-type {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-right: var(--choice-space-2);
  font-weight: 700;
  font-size: var(--choice-text-sm);
  line-height: 1.4;
  color: var(--choice-text-muted);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: 1px 6px;
  white-space: nowrap;
}

.choice-float-option-content {
  line-height: 1.4;
  font-size: var(--choice-text-sm);
  overflow-wrap: anywhere;
}

/* ===== v55 骰子判定：成功率徽标 + 行内判定 chip（骰子开关开启即显示，独立于 HUD）===== */
/* 成功率徽标：类型徽标旁的小 pill，无边框轻量，彩色加粗文字按把握分档着色 */
.choice-float-option-rate {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-right: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
}

.choice-float-option-rate--high {
  color: var(--choice-color-success);
}

.choice-float-option-rate--mid {
  color: var(--choice-color-info);
}

.choice-float-option-rate--low {
  color: var(--choice-color-warning);
}

/* 行内判定 chip：悬停在行尾（不占内容流），点选后淡出到半透明滞留；
   父级 .choice-float-option 已是 absolute 定位基准 */
.choice-float-roll-chip {
  position: absolute;
  right: var(--choice-space-2);
  top: 50%;
  transform: translateY(-50%);
  font-style: normal;
  font-size: var(--choice-text-xs);
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--choice-radius-sm);
  animation: choice-float-roll-chip-fade 3s ease forwards;
}

.choice-float-roll-chip--success,
.choice-float-roll-chip--crit_success {
  color: var(--choice-color-success);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-color-success);
}

.choice-float-roll-chip--fail,
.choice-float-roll-chip--crit_fail {
  color: var(--choice-color-danger);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-color-danger);
}

@keyframes choice-float-roll-chip-fade {
  to {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .choice-float-roll-chip {
    animation: none;
  }
}

.choice-floating-options-empty {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-3) var(--choice-space-1);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-float-empty-action {
  font-size: var(--choice-text-sm);
}

/* 底部工具条：贴外壳底，边框与列表区隔开；触屏按钮保证可点高度 */
.choice-floating-options-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--choice-space-1) var(--choice-space-2);
  border-top: 1px solid var(--choice-border-strong);
  background: var(--choice-bg-element);
}

.choice-float-bar-spacer {
  flex: 1;
}

.choice-float-pager {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: auto;
}

.choice-float-pager-text {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 2px;
}

.choice-float-bar-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-float-bar-btn:hover:not(:disabled) {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-float-bar-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.choice-float-bar-btn--active {
  color: var(--choice-primary);
}

/* 生成按钮是工具条主操作：主色图标区分，不加底色（同主面板 header 语言） */
.choice-float-bar-btn--main {
  color: var(--choice-primary);
}

.choice-float-bar-btn--main:hover:not(:disabled) {
  color: var(--choice-primary-hover);
}

/* 触屏触控目标：锁/生成/设置与分页是高频点击点，抬到可点高度 */
@media (pointer: coarse) {
  .choice-float-bar-btn {
    min-height: var(--choice-tap-min);
    padding: var(--choice-space-2);
  }
}
</style>
