<template>
  <Teleport to="body">
    <div
      ref="bubbleEl"
      class="choice-floating-bubble"
      :class="{
        'choice-floating-bubble--dragging': isDragging,
        'choice-floating-bubble--generating': bubbleState === 'generating',
        'choice-floating-bubble--idle': bubbleState === 'idle' && !isDragging,
        'choice-floating-bubble--disabled': bubbleState === 'disabled',
        'choice-floating-bubble--snapped-left': isSnappedLeft && !isDragging,
        'choice-floating-bubble--snapped-right': isSnappedRight && !isDragging,
        'choice-floating-bubble--pressed': isPressed,
        'choice-floating-bubble--above-overlay': isSettingsOpen,
      }"
      :style="{
        '--choice-x': x + 'px',
        '--choice-y': y + 'px',
        width: BUBBLE_SIZE + 'px',
        height: BUBBLE_SIZE + 'px',
        '--choice-bubble-icon-size': BUBBLE_SIZE / 3 + 'px',
        transition:
          isDragging || isResizing
            ? 'none'
            : isPressed
              ? 'transform 0.12s ease-out'
              : 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }"
      title="行动选项设置"
    >
      <div class="choice-bubble-inner-ring"></div>
      <i
        :class="
          isGenerating ? 'fa-solid fa-spinner fa-spin choice-bubble-icon' : 'fa-solid fa-chess choice-bubble-icon'
        "
      ></i>
    </div>
    <FloatingContextMenu v-if="isBubbleContextMenuOpen" />
  </Teleport>
</template>

<script setup lang="ts">
import { resolveCustomApi } from '@/core/generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { generatorState } from '@/core/generator';
import { toggleSettings, isSettingsOpen, isBubbleContextMenuOpen, bubbleX, bubbleY } from '@/core/floating-state';
import FloatingContextMenu from '@/components/FloatingContextMenu.vue';

// 气泡直径：手机（窄触屏）压到 48px，其余 60px。必须是响应式值——拖拽 clamp、
// 贴边吸附、初始位置默认值全依赖它；渲染尺寸也由它经 :style 单一来源驱动，
// CSS 不允许再写一份 width/height（两处常量必然漂移，clamp 用的逻辑尺寸会先失真）
const MOBILE_BUBBLE_QUERY = '(pointer: coarse) and (max-width: 480px)';
const mobileBubbleMql = window.matchMedia(MOBILE_BUBBLE_QUERY);
const isMobilePointer = ref(mobileBubbleMql.matches);
const onMobileBubbleChange = (e: MediaQueryListEvent) => {
  isMobilePointer.value = e.matches;
};
mobileBubbleMql.addEventListener('change', onMobileBubbleChange);

const BUBBLE_SIZE = computed(() => (isMobilePointer.value ? 48 : 60));
// 贴边隐藏量 = 直径的 1/3（露 2/3）：按比例而非固定 px——桌面 60px 藏 20px 是
// 长期验证的观感基准；早先手机沿用固定露出 40px，48px 球只藏 8px 几乎全露
// （真机反馈"露出来太多"）。取 1/3 直径后两档观感一致
const SNAP_OFFSET = computed(() => Math.round(BUBBLE_SIZE.value / 3));
// 点击/长按共用的指针净位移阈值：松手时位移小于它视为点击，大于它视为拖拽意图（取消长按）
const TAP_SLOP = 8;
const STORAGE_KEY_X = 'choice_floating_bubble_x';
const STORAGE_KEY_Y = 'choice_floating_bubble_y';
// 按住气泡期间挂在 body 上的禁选类，样式定义在 theme.css（body 级，scoped 写不到）
const SUPPRESS_SELECT_CLASS = 'choice-suppress-select';

const isGenerating = computed(() => generatorState.loading);

const posX = useStorage(STORAGE_KEY_X, window.innerWidth - BUBBLE_SIZE.value - 16);
const posY = useStorage(STORAGE_KEY_Y, window.innerHeight - BUBBLE_SIZE.value - 80);

const isSnappedLeft = ref(false);
const isSnappedRight = ref(false);

const isDisabled = computed(() => {
  const gs = useGlobalSettingsStore();
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  const pool = usePoolSelectorStore().effectivePool;
  return !api || pool.length === 0;
});

const bubbleState = computed(() => {
  if (isDisabled.value) return 'disabled';
  if (isGenerating.value) return 'generating';
  if (isDragging.value) return 'dragging';
  return 'idle';
});

const bubbleEl = ref<HTMLElement | null>(null);

// 按压态只做整体 scale 反馈。禁止给容器加任何会改变 getBoundingClientRect 的位移效果
// （比如曾经的"贴边弹出 translateX(20px)"）：useDraggable 的拖拽锚点取自 pointerdown 时
// 的视觉矩形（VueUse 13.9.0 实现为 e.clientX - targetRect.left，getBoundingClientRect
// 含 CSS transform），容器一带位移锚点就偏离逻辑坐标——点击时 1px 指针抖动会让
// position 突跳 ~20px，松手被误判成拖拽，即"贴边球点一下弹一下、面板打不开"的根因。
// 位移类视觉提示只能放在子元素上（子元素 transform 不影响容器矩形），见样式里
// snapped:hover 的图标 nudge。按压缩放本身安全：锚点在 VueUse 的 capture 阶段采集，
// 早于 pressed 类生效；且 scale 不改 translate，残余偏差 ≤2.4px 不可见。
const isPressed = ref(false);

const handleClick = () => {
  isBubbleContextMenuOpen.value = false;
  bubbleX.value = posX.value;
  bubbleY.value = posY.value;
  // 单击切换开/关：面板开着时点气泡应关闭，而不是反复置 true。
  // 前提是气泡在遮罩之上（见 --above-overlay 的 z-index 提升），否则第二次点击被遮罩吞掉
  toggleSettings();
};

const { x, y, isDragging } = useDraggable(bubbleEl, {
  initialValue: { x: posX.value, y: posY.value },
  // 按压期间指针净位移超过 TAP_SLOP 即转入拖拽意图：取消长按计时、撤掉按压缩放，
  // 让球以完整尺寸跟手。onMove 由 VueUse 接在 window 上，不怕指针滑出气泡范围
  onMove: (_pos, e) => {
    if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > TAP_SLOP) {
      clearLongPressTimer();
      isPressed.value = false;
    }
  },
  onEnd: (finalPos, e) => {
    // window 级 pointerup 必达，在这里兜底清长按计时器：元素级监听可能因指针滑出
    // 气泡收不到 up，漏清会形成"幽灵长按"——面板刚被点开，500ms 后菜单又自己弹出
    clearLongPressTimer();
    isPressed.value = false;
    document.body.classList.remove(SUPPRESS_SELECT_CLASS);

    const SNAP_THRESHOLD = 100;
    const centerX = finalPos.x + BUBBLE_SIZE.value / 2;
    const distToLeft = centerX;
    const distToRight = window.innerWidth - centerX;

    let snappedX: number;
    if (distToLeft < SNAP_THRESHOLD) {
      snappedX = -SNAP_OFFSET.value;
      isSnappedLeft.value = true;
      isSnappedRight.value = false;
    } else if (distToRight < SNAP_THRESHOLD) {
      snappedX = window.innerWidth - BUBBLE_SIZE.value + SNAP_OFFSET.value;
      isSnappedLeft.value = false;
      isSnappedRight.value = true;
    } else {
      snappedX = Math.max(0, Math.min(finalPos.x, window.innerWidth - BUBBLE_SIZE.value));
      isSnappedLeft.value = false;
      isSnappedRight.value = false;
    }

    posX.value = snappedX;
    posY.value = Math.max(0, Math.min(finalPos.y, window.innerHeight - BUBBLE_SIZE.value));
    x.value = snappedX;
    y.value = posY.value;

    bubbleX.value = snappedX;
    bubbleY.value = posY.value;

    // 点击判定用指针净位移而非元素位置差：元素位置被视觉位移污染（见 isPressed 注释），
    // 指针位移才是"点击意图"的正确度量。8px 容忍触摸抖动，与长按取消共用同一阈值
    const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    if (moved < TAP_SLOP && !longPressTriggered) {
      handleClick();
    }
    longPressTriggered = false;
  },
});

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;
let pointerDownPos = { x: 0, y: 0 };

const clearLongPressTimer = () => {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
};

const onPointerDown = (e: PointerEvent) => {
  // 右键交给 contextmenu 处理，与 useDraggable 默认 buttons:[0] 对齐
  if (e.button !== 0) return;
  longPressTriggered = false;
  pointerDownPos = { x: e.clientX, y: e.clientY };
  isPressed.value = true;
  // 手机端长按会触发原生文本选择：安卓 Chromium 对 user-select:none 的元素长按，
  // 仍可能选中附近的聊天文本；iOS 则弹出系统 callout。preventDefault 抑制兼容鼠标
  // 事件与长按选择手势——useDraggable 用 pointer 事件且监听器照常触发（不阻断传播），
  // 拖拽不受影响；气泡无 focus/输入依赖，取消默认行为安全
  if (e.pointerType !== 'mouse') {
    e.preventDefault();
  }
  // 按住期间（直到松手/取消）在 body 级兜底禁选：盖住长按选中"附近文本"的路径。
  // 必须与清理成对出现（onEnd/pointercancel/onUnmounted 三处兜底）——漏移除会导致
  // 全站文本无法选中，属于不可见的高危回归
  document.body.classList.add(SUPPRESS_SELECT_CLASS);
  // 长按菜单仅触屏/笔生效：鼠标按住半秒是常见误操作（原本会吞掉点击），鼠标改用右键
  if (e.pointerType !== 'mouse') {
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      isPressed.value = false;
      bubbleX.value = posX.value;
      bubbleY.value = posY.value;
      isBubbleContextMenuOpen.value = true;
    }, 500);
  }
};

// touch-action:none 已阻断滚动接管，pointercancel 罕见；VueUse 只监听 pointerup，
// cancel 不会走 onEnd，这里兜底清理按压态与计时器
const onPointerCancel = () => {
  clearLongPressTimer();
  isPressed.value = false;
  document.body.classList.remove(SUPPRESS_SELECT_CLASS);
};

// 鼠标右键呼出应用菜单（触屏长按的等价物）。FloatingContextMenu 的 document 级
// pointerdown 关闭逻辑忽略气泡来源的点击，不会被同一次右键的 pointerdown 立即关掉
const onContextMenu = (e: MouseEvent) => {
  e.preventDefault();
  bubbleX.value = posX.value;
  bubbleY.value = posY.value;
  isBubbleContextMenuOpen.value = true;
};

// 初始位置判断：如果存储的 x 靠左或靠右，初始化吸附状态
watch(
  posX,
  val => {
    const centerX = val + BUBBLE_SIZE.value / 2;
    isSnappedLeft.value = centerX < window.innerWidth / 2 && (val === -SNAP_OFFSET.value || val <= 0);
    isSnappedRight.value =
      centerX >= window.innerWidth / 2 &&
      (val === window.innerWidth - BUBBLE_SIZE.value + SNAP_OFFSET.value ||
        val >= window.innerWidth - BUBBLE_SIZE.value);
    bubbleX.value = val;
    bubbleY.value = posY.value;
  },
  { immediate: true },
);

const isResizing = ref(false);
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const handleResize = () => {
  isResizing.value = true;
  let clampedX: number;
  if (isSnappedLeft.value) {
    clampedX = -SNAP_OFFSET.value;
  } else if (isSnappedRight.value) {
    clampedX = window.innerWidth - BUBBLE_SIZE.value + SNAP_OFFSET.value;
  } else {
    clampedX = Math.max(0, Math.min(posX.value, window.innerWidth - BUBBLE_SIZE.value));
  }
  const clampedY = Math.max(0, Math.min(posY.value, window.innerHeight - BUBBLE_SIZE.value));
  posX.value = clampedX;
  posY.value = clampedY;
  x.value = clampedX;
  y.value = clampedY;
  bubbleX.value = clampedX;
  bubbleY.value = clampedY;

  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    isResizing.value = false;
  }, 200);
};

// 尺寸档切换（旋屏跨过 480px、外接/断开鼠标）不会触发 window resize，
// 但 clamp 边界变了：必须立即按新直径重夹位置，否则桌面存档位置在切到手机档时
// 可能超出 innerWidth - 48 的边界悬在屏外
watch(isMobilePointer, handleResize);

onMounted(() => {
  bubbleEl.value?.addEventListener('pointerdown', onPointerDown);
  bubbleEl.value?.addEventListener('pointercancel', onPointerCancel);
  bubbleEl.value?.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', handleResize);
  // 初始化钳制：位置存档（localStorage）可能是在更宽的窗口/别的设备下写入的，
  // 首次挂载若超出当前视口，球会整个悬在屏外（真机反馈"有时打开浏览器看不见
  // 悬浮球"）。resize 事件只在窗口变化时触发，覆盖不了"存档越界 + 视口未变"
  // 的加载场景，必须挂载时主动钳一次（幂等：贴边态按当前直径重吸附，界内则原样）
  handleResize();
});
onUnmounted(() => {
  bubbleEl.value?.removeEventListener('pointerdown', onPointerDown);
  bubbleEl.value?.removeEventListener('pointercancel', onPointerCancel);
  bubbleEl.value?.removeEventListener('contextmenu', onContextMenu);
  window.removeEventListener('resize', handleResize);
  mobileBubbleMql.removeEventListener('change', onMobileBubbleChange);
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  clearLongPressTimer();
  // 组件卸载兜底：按住状态下组件被卸载时，抑制类残留会让全站无法选字
  document.body.classList.remove(SUPPRESS_SELECT_CLASS);
});
</script>

<style scoped>
.choice-floating-bubble {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--choice-z-floating);
  /* 尺寸不在此写死：直径是 JS 侧 clamp/吸附计算的一部分（BUBBLE_SIZE computed），
     由 :style 单一来源驱动，双处常量必然漂移 */
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  color: var(--choice-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 图标随直径等比（1/3 直径），且保留字体档缩放联动（原为固定 --choice-text-xl，
     48px 手机球上 20px 图标偏挤） */
  font-size: calc(var(--choice-bubble-icon-size, 20px) * var(--choice-font-scale, 1));
  cursor: pointer;
  box-shadow: var(--choice-shadow-glow);
  touch-action: none;
  /* -webkit- 前缀版缺一不可：老 WebView 内核只认前缀写法；touch-callout 抑制
     iOS Safari 长按弹出的系统级菜单/放大镜（user-select 管不到它） */
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  transform: translate3d(var(--choice-x), var(--choice-y), 0);
  overflow: hidden;
}

.choice-floating-bubble--idle {
  opacity: 0.75;
  animation: choice-bubble-breathe 8s ease-in-out infinite;
}

.choice-floating-bubble--generating {
  animation: choice-bubble-pulse 3s ease-in-out infinite;
}

/* 禁用态只靠整体变暗+去色传达（右上角 ⚠ 角标已移除：overflow:hidden 剪裁下
   悬挂式被剪成豁口、收入界内又喧宾夺主，两版真机都不接受）；禁用原因仍可在
   悬浮面板/设置里看到，气泡本身保持干净 */
.choice-floating-bubble--disabled {
  opacity: 0.5;
  filter: grayscale(30%);
}

.choice-floating-bubble--dragging {
  will-change: transform;
}

/* 面板打开时把气泡提到遮罩(9000,含其子级对话框)之上：否则第二次点击气泡关闭面板时，
   点击被全屏遮罩吞掉，气泡永远收不到 click */
.choice-floating-bubble--above-overlay {
  z-index: calc(var(--choice-z-floating) + 1);
}

/* —— 悬停类反馈仅对真正支持 hover 的指针（鼠标）启用 ——
   触屏浏览器的 :hover 在点按后会粘滞（没有 pointerleave 时机）：松手、甚至设置
   面板关闭后，探出/放大态仍卡住不回弹（真机反馈"点击后棋子固定在内侧光环之外，
   有时不会回去"——"有时候"取决于浏览器是否保留该次点按的 hover 态）。
   触屏只保留贴边让位基础态；老内核不认此媒体条件时整块被忽略，仅失去悬停增强 */
@media (hover: hover) and (pointer: fine) {
  .choice-floating-bubble:hover {
    opacity: 1;
    box-shadow: 0 0 28px rgba(var(--choice-primary-rgb), 0.45);
  }

  /* 贴边态悬停禁止容器位移弹出（peek）：容器 transform 会改变 getBoundingClientRect，
     污染 useDraggable 拖拽锚点、把点击抖动放大成瞬移（根因见 script 内 isPressed 注释）。
     悬停提示改为图标向屏幕内侧多探出几 px——子元素 transform 不影响容器矩形。
     让位量随图标尺寸等比（0.7 倍），48px 手机球不再沿用桌面的固定 14px */
  .choice-floating-bubble--snapped-left:hover .choice-bubble-icon {
    transform: translateX(calc(var(--choice-bubble-icon-size, 20px) * 0.7));
  }

  .choice-floating-bubble--snapped-right:hover .choice-bubble-icon {
    transform: translateX(calc(var(--choice-bubble-icon-size, 20px) * -0.7));
  }

  /* 悬停放大排除按压态：否则此规则(0,4,0)特异性压过 pressed(0,1,0)，
     鼠标按下时收缩反馈永远不生效（按住时球必然处于 hover 中） */
  .choice-floating-bubble:not(.choice-floating-bubble--snapped-left):not(.choice-floating-bubble--snapped-right):not(
      .choice-floating-bubble--pressed
    ):hover {
    transform: translate3d(var(--choice-x), var(--choice-y), 0) scale(1.08);
  }
}

/* 按压态：整体轻微收缩作反馈，不加任何位移（根因见 script 内 isPressed 注释）。
   松手后由内联 transition 的回弹缓动放回，与拖拽吸附共用同一份缓动 */
.choice-floating-bubble--pressed {
  transform: translate3d(var(--choice-x), var(--choice-y), 0) scale(0.94);
}

.choice-bubble-inner-ring {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, var(--choice-primary), transparent 60%, var(--choice-primary));
  opacity: 0.3;
  pointer-events: none;
  /* 镂空成环：实心圆锥渐变的所有角度在圆心交汇，会出现一个彩色聚点——平时被
     居中图标盖住，贴边态图标向内侧让位后恰好露出来（真机反馈"贴边后中间有个点"）。
     radial mask 只留外圈，扫光变成贴边旋转的弧环；-webkit- 前缀版老内核也要认，
     两个都不认时整条被忽略，回落为原实心圆盘（仅观感回退，无功能影响） */
  -webkit-mask: radial-gradient(farthest-side, #0000 calc(100% - 4px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, #0000 calc(100% - 4px), #000 calc(100% - 3px));
}

.choice-floating-bubble--idle .choice-bubble-inner-ring {
  animation: choice-bubble-ring-spin 20s linear infinite;
}

.choice-floating-bubble--generating .choice-bubble-inner-ring {
  animation: choice-bubble-ring-spin 1.5s linear infinite;
  opacity: 0.5;
}

.choice-floating-bubble--disabled .choice-bubble-inner-ring {
  animation: none;
  opacity: 0.15;
}

.choice-bubble-icon {
  position: relative;
  z-index: 1;
  transition: transform 0.3s ease;
}

/* 贴边态图标向屏幕内侧让位：让位量随图标尺寸等比（0.5 倍图标高），固定 10px
   在 48px 手机球上占比过大，图标看起来快贴出球缘（真机反馈） */
.choice-floating-bubble--snapped-left .choice-bubble-icon {
  transform: translateX(calc(var(--choice-bubble-icon-size, 20px) * 0.5));
}

.choice-floating-bubble--snapped-right .choice-bubble-icon {
  transform: translateX(calc(var(--choice-bubble-icon-size, 20px) * -0.5));
}
</style>
