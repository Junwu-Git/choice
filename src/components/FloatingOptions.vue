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
        '--choice-option-font-scale': floatingFontScale,
      }"
      @pointerenter="dimmed = false"
      @pointerleave="onPointerLeave"
    >
      <!-- 选项列表：无标题栏的紧凑排版，每行「类型标签 + 内容」。
           生成中且无旧结果时显示加载占位，有旧结果则保留旧选项不闪烁（同主面板约定）。
           选项行本体（类型/需求值/判定 chip/档位色条）全部走 global.css 的
           .choice-option-btn 共享语言，与主面板同源 -->
      <div ref="bodyEl" class="choice-floating-options-body" :style="bodyHeightStyle">
        <template v-if="options.length > 0">
          <button
            v-for="(option, index) in options"
            :key="`${generationId}:${index}`"
            class="choice-option-btn"
            :class="optionBtnClass(option, index)"
            :style="optionBtnStyle(index)"
            @click="onSelect(option, index)"
          >
            <span class="choice-option-type">{{ parseOptionType(option.text) }}</span><!--
            --><span
              v-if="rateOf(option) !== null || formulaOf(option)"
              class="choice-option-rate"
              :class="formulaOf(option) ? 'choice-option-rate--formula' : rateClass(rateOf(option)!)"
              :title="rateTitle(option)"
              >{{ formulaOf(option) || rateOf(option) }}</span
            ><!--
            -->
            <span class="choice-option-content"
              >{{ parseOptionContent(option.text)
              }}<template v-if="!rollOf(index) && previewOf(index).length"
                ><span class="choice-card-tag-row"
                  ><span
                    v-for="pc in previewOf(index)"
                    :key="pc.id"
                    class="choice-card-tag choice-card-tag--preview"
                    :class="`choice-card-star--${pc.star}`"
                    :title="`${pc.name}：${t`判定可触发`} · ${pc.effects.map(effectSummary).join('·')}`"
                    ><i class="fa-solid fa-bolt"></i>{{ pc.name }}</span
                  ></span
                ></template
              ><i
                v-if="rollOf(index)"
                class="choice-roll-chip"
                :class="`choice-roll-chip--${rollOf(index)!.outcome}`"
                >{{ rollChipText(rollOf(index)!) }}</i
              ><template v-if="rollOf(index)?.cards?.triggered?.length"
                ><span class="choice-card-tag-row"
                  ><span
                    v-for="tc in rollOf(index)!.cards!.triggered"
                    :key="tc.card.id"
                    class="choice-card-tag"
                    :class="`choice-card-star--${tc.card.star}`"
                    :title="`${tc.card.name}：${tc.summary}`"
                    ><i class="fa-solid fa-id-badge"></i>{{ tc.card.name }}</span
                  ></span
                ></template
              ><span
                v-if="isPending(index)"
                class="choice-roll-reroll"
                role="button"
                :title="t`重掷`"
                @click.stop="onReroll(option, index)"
                ><i class="fa-solid fa-rotate"></i></span
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

      <!-- 调整态拖动条区：两条独立的「宽度 / 高度」拖动条，放在选项区上方。
           方向恒定直观——宽度条向右拖增宽（固定左缘右扩）、高度条向下拖增高
           （固定顶缘下延），不再依赖弹窗相对气泡的方位，避免对角把手的反向困扰。
           正常态不显示，仅调整态挂载 -->
      <div v-if="adjusting" class="choice-floating-adjust-bar">
        <span
          class="choice-float-adjust-grip"
          :title="t`拖动调整弹窗宽度`"
          @pointerdown.stop.prevent="onWidthResizeStart"
        >
          <i class="fa-solid fa-arrows-left-right"></i>
          {{ t`宽度` }}
        </span>
        <span
          class="choice-float-adjust-grip"
          :title="t`拖动调整弹窗高度`"
          @pointerdown.stop.prevent="onHeightResizeStart"
        >
          <i class="fa-solid fa-arrows-up-down"></i>
          {{ t`高度` }}
        </span>
      </div>

      <!-- 底部工具条：左端分页（仅多组结果时显示），右端锁/生成/设置；
           按钮用 global.css 的 .choice-tool-btn 原子，与主面板头部工具区同语言 -->
      <div class="choice-floating-options-bar">
        <!-- 调整态：工具条换成字号档分段 + 重置默认尺寸；原工具按钮隐藏避免误触，
             调整按钮保留在右端作为「完成调整」出口（同主面板调整态约定） -->
        <template v-if="adjusting">
          <div class="choice-floating-adjust-font choice-seg">
            <button
              v-for="opt in adjustFontOptions"
              :key="opt.value"
              class="choice-seg-btn"
              :class="{ active: isAdjustFontActive(opt.value) }"
              :title="opt.tip"
              @click="applyAdjustFont(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
          <button class="choice-tool-btn" :title="t`恢复默认弹窗大小与字号`" @click="onResetSize">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <span class="choice-float-bar-spacer"></span>
          <button class="choice-tool-btn choice-tool-btn--active" :title="t`完成调整`" @click="onToggleAdjust">
            <i class="fa-solid fa-sliders"></i>
          </button>
        </template>
        <!-- 正常态：原工具条内容 -->
        <template v-else>
          <span v-if="generations.length > 1" class="choice-float-pager">
            <button class="choice-tool-btn" :disabled="currentIndex <= 0" :title="t`上一组`" @click="onPrev">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span class="choice-float-pager-text">{{ currentIndex + 1 }}/{{ generations.length }}</span>
            <button
              class="choice-tool-btn"
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
            class="choice-tool-btn choice-tool-btn--main"
            :title="isGenerating ? t`取消生成` : t`生成选项`"
            @click="onToggle"
          >
            <i :class="isGenerating ? 'fa-solid fa-stop' : 'fa-solid fa-wand-magic-sparkles'"></i>
          </button>
          <!-- 锁：弹窗独立锁 floating_options_lock（off/open 二态），与聊天面板 panel_lock 解耦，
               激活高亮；锁定时点选项弹窗不收起 -->
          <button
            class="choice-tool-btn"
            :class="{ 'choice-tool-btn--active': locked }"
            :title="locked ? t`解锁弹窗（点选项后收起）` : t`锁定弹窗（点选项后不收起）`"
            @click="onToggleLock"
          >
            <i :class="locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
          </button>
          <!-- 淡化开关：仅锁定 + 支持 hover 的设备显示（淡化只在锁定态、且鼠标移出选项栏
               时才生效）。开启时激活高亮，关闭则锁定态移出不淡化 -->
          <button
            v-if="locked && hoverable.matches"
            class="choice-tool-btn"
            :class="{ 'choice-tool-btn--active': dimEnabled }"
            :title="dimEnabled ? t`淡化已开启：锁定态移出选项栏变半透明` : t`淡化已关闭：锁定态移出不淡化`"
            @click="onToggleDim"
          >
            <i class="fa-solid fa-circle-half-stroke"></i>
          </button>
          <!-- 设置入口恒在工具区最右；调整按钮在其左侧（同主面板调整在设置左侧） -->
          <button class="choice-tool-btn" :title="t`调整弹窗大小与字号`" @click="onToggleAdjust">
            <i class="fa-solid fa-sliders"></i>
          </button>
          <button class="choice-tool-btn" :title="t`打开设置`" @click="openSettings">
            <i class="fa-solid fa-gear"></i>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { cancelGeneration, generateOptions, generatorState, resolveCustomApi } from '@/core/generator';
import { storeGeneration, isCardSettled, cardSettleEpoch } from '@/core/options-store';
import type { ChoiceOption } from '@/core/options-store';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { openApiOnboarding, autoOpenApiOnboarding } from '@/core/onboarding';
import { openSettings, closeBubbleOptions, isSettingsOpen, bubbleX, bubbleY, bubbleSize } from '@/core/floating-state';
import { parseOptionType, parseOptionContent, parseOptionStyle, parseOptionDice } from '@/util/option-format';
import { applyOptionBehavior, isOptionApplyBusy, rollOptionDice, type DiceRollResult } from '@/util/option-action';
import { openCardPack } from '@/core/card-pack-state';
import { previewTriggeredCards, type CardResolution } from '@/core/cards';
import { effectSummary } from '@/core/cards-meta';
import type { Card } from '@/type/settings';
import { resolveRateForDisplay } from '@/core/attribute-dc';
import { getStCharacter } from '@/core/st-character';
import type { DiceOutcome } from '@/core/dice';
import { OPTION_FONT_SCALE } from '@/core/constants';

// 淡化反馈仅对真正支持 hover 的指针（鼠标）生效：pointerenter/pointerleave 在触屏上
// 语义不同——点按弹窗内选项也会先 enter、抬手后 leave，直接使用会导致手机上点完
// 选项后弹窗误判"移出"而残留半透明。MQL 常量在模块加载时求值，设备固定不变（同
// floating-state 的 isMobileBubble 做法）
const HOVERABLE_QUERY = '(hover: hover) and (pointer: fine)';
const hoverable = window.matchMedia(HOVERABLE_QUERY);

const gs = useGlobalSettingsStore();
const panelStore = usePanelStateStore();

// 选项 popover 宽度：320px 封顶（放得下类型标签 + 内容），窄屏让给视口；
// 进调整态拖「宽度」拖动条后可固化（floating_popover_width > 0 用该值），0 = 自动。
// 注意：computed 惰性求值，这里对 gs 的引用在渲染时才执行、gs 已就绪
const POPOVER_WIDTH_AUTO = 320;
// 与气泡之间的固定间隙（与 FloatingContextMenu 的 8px 一致）
const POPOVER_GAP = 8;

// 视口尺寸走 useWindowSize 响应式：computed 里裸读 window.innerWidth/innerHeight 不被
// 依赖追踪，旋转屏幕/缩放窗口后按旧视口定位，弹窗可部分出屏（外壳 max-width 只兜宽度
// 不兜位置；FloatingContextMenu 同款修复）
const { width: winWidth, height: winHeight } = useWindowSize();

const popoverWidth = computed(() => {
  const w = gs.settings.ui.floating_popover_width;
  return w > 0 ? w : Math.min(POPOVER_WIDTH_AUTO, winWidth.value - 16);
});
// 选项区限高（floating_popover_height > 0 用该值，0 = 自动 55dvh）：分态——
// 调整态用固定 height（内容不足时下方露留白、随拖动实时变化，让设定高度可感知，
// 避免「选项少时拖高看不见效果」）；正常态用 max-height 收紧（选项少只撑到内容高度）。
// 与主面板（ActionOptionsPanel.bodyHeightStyle）同一套约定
const bodyHeightStyle = computed(() => {
  const h = gs.settings.ui.floating_popover_height;
  if (h <= 0) return {};
  return adjusting.value ? { height: `${h}px`, maxHeight: 'none' } : { maxHeight: `${h}px` };
});
// 悬浮球弹窗独立字号档缩放系数（constants.ts 共享 OPTION_FONT_SCALE，与聊天面板同源）
const floatingFontScale = computed(() => {
  const ui = gs.settings.ui;
  return ui.floating_option_font_size_auto ? 1 : OPTION_FONT_SCALE[ui.floating_option_font_size];
});

const popoverEl = ref<HTMLElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);
const dimmed = ref(false);

const onPointerLeave = () => {
  // 仅锁定 + 支持 hover + 用户开启淡化时才淡化；未锁定时移出不淡化
  // （未锁定外部点击本来就关闭弹窗，无需淡出反馈）
  if (locked.value && hoverable.matches && dimEnabled.value) {
    dimmed.value = true;
  }
};

// 弹窗只读「行动选项」数据，不读润色视图（enrich）——聊天 UI 关闭时润色不可用，
// 弹窗定位为纯选项速选菜单。用 currentGeneration 而非 visibleOptions 是故意的：
// visibleOptions 会随 activeView 切到 enrich，弹窗没有润色概念，不应跟着变空
const options = computed(() => panelStore.currentGeneration?.options ?? []);
const currentIndex = computed(() => panelStore.currentIndex);
const generations = computed(() => panelStore.generations);

const isGenerating = computed(() => generatorState.loading);
// 弹窗锁独立于聊天面板锁（floating_options_lock off/open 二态）：面板的 panel_lock
// 管「展开/收起自动化」，弹窗没有折叠概念、只问「点选项后收不收起」，两者不共享状态
const locked = computed(() => gs.settings.ui.floating_options_lock !== 'off');
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
    'choice-option-btn--conservative': grade === 'conservative',
    'choice-option-btn--balanced': grade === 'balanced',
    'choice-option-btn--bold': grade === 'bold',
    'choice-option-btn--selected': selectedKeys.value.has(`${generationId.value}:${index}`),
  };
};

const optionBtnStyle = (index: number): Record<string, string> => {
  if (!hudEnabled.value) return {};
  return { animationDelay: `${index * 60}ms` };
};

// 骰子判定（v56 难度制）：需求值徽标与行内判定 chip 的总开关（独立于 HUD）。
// 徽标显示规则 = 骰子开 + 该选项可解析出需求值（AI 标注/属性/档位兜底/骰式代理，v61）
const diceEnabled = computed(() => gs.settings.dice.enabled);
// v61：徽标与判定共用同一需求值解析（见 attribute-dc.resolveRateForDisplay）；当前角色取
// store 的响应式 currentCharacterId
const currentChar = computed(() => (gs.currentCharacterId != null ? getStCharacter(gs.currentCharacterId) : undefined));
const rateOf = (option: ChoiceOption): number | null =>
  diceEnabled.value ? resolveRateForDisplay(option.text, currentChar.value, gs.settings.dice) : null;
// v61 骰式表达式：选项是否骰式标注，返回骰式文本（如 2d6+3）；allow_formula 关或非骰式返回 null
const formulaOf = (option: ChoiceOption): string | null =>
  gs.settings.dice.allow_formula ? (parseOptionDice(option.text)?.formula ?? null) : null;
// v67 徽标 tooltip：骰式标骰式+难度代理；普通徽标按判定方向说明成功条件（COC 与 DND 语义相反）。
// 与主面板 ActionOptionsPanel 同构（并行模式，两处需同步改动）
const rateTitle = (option: ChoiceOption): string => {
  const formula = formulaOf(option);
  if (formula) return `${t`骰式`} ${formula}（${t`难度`} ${rateOf(option)}）`;
  if (gs.settings.dice.low_roll) return t`COC：掷出 ≤ 该值才算成功`;
  return t`DND：掷出 ≥ 该值才算成功`;
};
// 徽标语义色按需求值分档（v56 难度制）：高需求（≥70）难=橙 / 中（40-69）青 / 低（<40）易=绿；
// 分档色走 --choice-rate-*（中档 = 主色），与 risk 档位色条语义区分（同主面板，配色反转见 theme.css）
const rateClass = (rate: number): string =>
  rate >= 70 ? 'choice-option-rate--high' : rate >= 40 ? 'choice-option-rate--mid' : 'choice-option-rate--low';

// 楼层是否已结算卡牌经济（预掷/重掷与判定路径同门控）。结算态非响应式，
// 依赖追踪靠 cardSettleEpoch（markCardSettled 自增，跨组件结算也会触发重算）
const layerSettled = (): boolean =>
  panelStore.messageId != null && isCardSettled(panelStore.messageId, panelStore.swipeId);

// v66 点选前触发预览：与主面板 ActionOptionsPanel 同构（并行模式，两处需同步改动）。
// 弹窗只有选项视图、无润色概念，故不做 activeView 门控；骰子可用性门控与主面板一致。
// 整表算一次缓存。
const cardPreviews = computed<Card[][]>(() => {
  void cardSettleEpoch.value;
  if (!gs.settings.card_enabled || !diceEnabled.value || gs.settings.dice.allow_formula) return [];
  if (layerSettled()) return [];
  return options.value.map(o =>
    previewTriggeredCards(o.text, currentChar.value, {
      attr_dc_enabled: gs.settings.dice.attr_dc_enabled,
      low_roll: gs.settings.dice.low_roll,
    }),
  );
});
const previewOf = (index: number): Card[] => cardPreviews.value[index] ?? [];

// 行内判定反馈：同代内点过的选项记一次判定结局+差值（纯视觉，不持久化），
// key 用「generation id + 行号」，切代自然失效（同 selectedKeys 机制）。
// v57：差值 = 判定 margin；v61 起 margin 由 option-action 经 diceMargin 归一化（成功侧为正），
// chip 显示「结局+差值」如「成功 +18」「失败 −38」。
type RollResult = { outcome: DiceOutcome; margin: number; cards?: CardResolution };
const rollResults = ref<ReadonlyMap<string, RollResult>>(new Map());
// v61 就地重掷两步流状态：stagedFull = 已 stage 未应用的完整判定结果（含 roll/rate 供 marker），
// pendingApply = 已 stage 未应用的 key 集合（决定是否显示 ↻）。正常流程（reroll 关）不写这两个。
const stagedFull = ref<ReadonlyMap<string, DiceRollResult>>(new Map());
const pendingApply = ref<ReadonlySet<string>>(new Set());
const keyOf = (index: number): string => `${generationId.value}:${index}`;
const rollOf = (index: number): RollResult | null => rollResults.value.get(keyOf(index)) ?? null;
const isPending = (index: number): boolean => pendingApply.value.has(keyOf(index));
const rollLabel = (o: DiceOutcome): string =>
  o === 'crit_success' ? t`大成功` : o === 'crit_fail' ? t`大失败` : o === 'success' ? t`成功` : t`失败`;
// 带符号差值：正数加 +、0 显示 0（恰好达标），负数为 −
const fmtMargin = (m: number): string => (m > 0 ? `+${m}` : String(m));
const rollChipText = (r: RollResult): string => `${rollLabel(r.outcome)} ${fmtMargin(r.margin)}`;

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
  // 弹窗没有「折叠」概念：锁只在 off/open 间切换（open=锁定常开=点选项不收起）。
  // 与聊天面板锁解耦，写独立字段 floating_options_lock，两处互不同步
  gs.settings.ui.floating_options_lock = locked.value ? 'off' : 'open';
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
  // 同楼层点击处理中（上一击 send 往返窗口）：整次忽略，防重复应用与误留选中态
  if (isOptionApplyBusy(panelStore.messageId, panelStore.swipeId)) return;
  // 弹窗是纯行动选项速选菜单（无润色视图），view 恒为 'options'，明确传入计价口径；
  // poolEntryIds/generationId 取被点选项所在代，供统计整轮归因与同代去重
  // （见 option-action.ts / core/stats.ts）
  const d = gs.settings.dice;
  const key = keyOf(index);
  // v61 就地重掷两步流（reroll_enabled 且本选项会掷骰）：首掷只 stage（出示 ↻、不应用不发送），
  // 再次点击 = 用已 stage 结果应用。正常流程（reroll 关）保持原「点击即掷+应用」。
  const willRoll = d.enabled && resolveRateForDisplay(option.text, currentChar.value, d) !== null;
  if (willRoll && d.reroll_enabled && !pendingApply.value.has(key)) {
    // 预掷与判定路径同结算门控：已结算楼层走非卡路径，防预告的卡触发在实际应用时被剥除
    const staged = rollOptionDice(option.text, { cardDisabled: layerSettled() });
    if (staged) {
      rollResults.value = new Map(rollResults.value).set(key, {
        outcome: staged.outcome,
        margin: staged.margin,
        cards: staged.cards,
      });
      stagedFull.value = new Map(stagedFull.value).set(key, staged);
      pendingApply.value = new Set(pendingApply.value).add(key);
      return; // 首掷只出示 ↻，不应用；弹窗保持打开供重掷/确认
    }
  }
  const preRolled = willRoll && d.reroll_enabled ? (stagedFull.value.get(key) ?? null) : undefined;
  const dice = await applyOptionBehavior(option, behavior.value, {
    view: 'options',
    poolEntryIds: panelStore.currentGeneration?.poolEntryIds ?? [],
    generationId: panelStore.currentGeneration?.id,
    matchedEntryId: option.matchedEntryId,
    scopeId: panelStore.currentGeneration?.scopeId,
    messageId: panelStore.messageId ?? undefined,
    swipeId: panelStore.swipeId,
    ...(preRolled ? { preRolled } : {}),
  });
  // 行内判定 chip（v57 骰子结果：结局+差值，返回值非 null = 本次真的掷了骰）
  if (dice) {
    rollResults.value = new Map(rollResults.value).set(key, {
      outcome: dice.outcome,
      margin: dice.margin,
      cards: dice.cards,
    });
    // v62 幸运数命中 → 开卡包弹窗（与主面板共用同一弹窗信号，双实现不冲突）
    if (dice.cards?.packOffer) openCardPack(dice.cards.packOffer, 'lucky');
  }
  // 重掷流已应用：清 stage 态（↻ 消失，保留 chip 作为本次判定反馈）
  if (willRoll && d.reroll_enabled) {
    const np = new Set(pendingApply.value);
    np.delete(key);
    pendingApply.value = np;
    const ns = new Map(stagedFull.value);
    ns.delete(key);
    stagedFull.value = ns;
  }
  // 已选打勾（HUD 视觉反馈）：选中成功后才标记，与统计口径无关
  markOptionSelected(index);
  panelStore.autoSetCollapsed(true);
  // 锁定时点选项不收起（与主面板「锁定不被动收起」语义一致）；未锁定则选中即关
  if (!locked.value) {
    closeBubbleOptions();
  }
};

// v61 就地重掷：重掷当前选项（重新掷骰并更新 chip 与 stage 结果），不应用不发送。
// 由 chip 旁的 ↻ 触发（@click.stop，避免误触选项本体）；与判定路径同结算门控。
const onReroll = (option: ChoiceOption, index: number) => {
  const full = rollOptionDice(option.text, { cardDisabled: layerSettled() });
  if (!full) return;
  const key = keyOf(index);
  rollResults.value = new Map(rollResults.value).set(key, {
    outcome: full.outcome,
    margin: full.margin,
    cards: full.cards,
  });
  stagedFull.value = new Map(stagedFull.value).set(key, full);
};

// 调整态位置快照：进入调整态时锁定弹窗当前坐标，期间不跟气泡重算、也不随尺寸重算。
// 原因：拖动中宽度实时变化会触发 popoverX 的「气泡右侧↔翻左侧」判定来回跳变，弹窗会
// 左右乱抖；锁住坐标后把手拖动只改尺寸、位置不动，退出调整态再按新尺寸实时重新定位
const adjustPos = ref<{ x: number; y: number } | null>(null);

// 横向：优先放气泡右侧；右侧放不下（贴右边缘）翻到左侧；夹取在视口内。
// 竖向：锚定气泡上缘，但气泡若靠下导致弹出空间不足，上移让 popover 底部不越出
// 视口（用当前配置高度/55dvh 上限作高度估计，保证至少留 8px 边距）
const popoverX = computed(() => {
  if (adjustPos.value) return adjustPos.value.x;
  const size = bubbleSize.value;
  const right = bubbleX.value + size + POPOVER_GAP;
  if (right + popoverWidth.value <= winWidth.value) {
    return right;
  }
  // 视口缩窄（旋转屏幕/改窗口）后气泡可能是越界旧位置，左翻后还要钳上界，否则右缘出屏
  const left = Math.max(8, bubbleX.value - popoverWidth.value - POPOVER_GAP);
  return Math.min(left, Math.max(8, winWidth.value - popoverWidth.value - POPOVER_GAP));
});

const popoverY = computed(() => {
  if (adjustPos.value) return adjustPos.value.y;
  // 高度估计用当前配置高度（自定义/自动），保证退出调整态后按新尺寸重新定位不越出视口
  const h = gs.settings.ui.floating_popover_height;
  const estHeight = h > 0 ? h : Math.min(winHeight.value * 0.55, winHeight.value - 16);
  const maxTop = Math.max(8, winHeight.value - estHeight - 8);
  return Math.max(8, Math.min(bubbleY.value, maxTop));
});

// ── 调整态（组件内存态，不持久化）──────────────────────────────────────────────
// 底部工具条「调整」按钮进入：选项区上方出现「宽度 / 高度」两条拖动条，工具条换成
// 字号档分段 + 重置。方向恒定直观（固定左缘右扩、固定顶缘下延），不依赖弹窗方位。
// 正常态保持干净布局，不显示任何调整控件
const adjusting = ref(false);

const adjustFontOptions = [
  { value: 'auto', label: t`自动`, tip: t`跟随全局字体档（不额外缩放）` },
  { value: 'small', label: t`小`, tip: t`弹窗内小号文字，更紧凑` },
  { value: 'medium', label: t`中`, tip: t`弹窗内默认文字大小` },
  { value: 'large', label: t`大`, tip: t`弹窗内大号文字，阅读更舒适` },
];
const isAdjustFontActive = (v: string) =>
  v === 'auto'
    ? gs.settings.ui.floating_option_font_size_auto
    : !gs.settings.ui.floating_option_font_size_auto &&
      gs.settings.ui.floating_option_font_size === (v as 'small' | 'medium' | 'large');
const applyAdjustFont = (v: string) => {
  if (v === 'auto') {
    gs.settings.ui.floating_option_font_size_auto = true;
    return;
  }
  gs.settings.ui.floating_option_font_size = v as 'small' | 'medium' | 'large';
  gs.settings.ui.floating_option_font_size_auto = false;
};
const onResetSize = () => {
  gs.settings.ui.floating_popover_width = 0;
  gs.settings.ui.floating_popover_height = 0;
  gs.settings.ui.floating_option_font_size_auto = true;
};

const onToggleAdjust = () => {
  if (!adjusting.value) {
    // 进入调整态：快照当前坐标（锁左缘/顶缘，拖动中不跟气泡/不随尺寸重算，避免
    // 拖动时弹出位置左右乱跳）；顺带复位淡化半透明态（锁定移出淡化的残留会
    // 影响调整时的可读性）
    dimmed.value = false;
    adjustPos.value = { x: popoverX.value, y: popoverY.value };
    adjusting.value = true;
  } else {
    adjusting.value = false;
    adjustPos.value = null;
  }
};

// ── 宽/高拖动条（ui.floating_popover_width / _height，0 = 自动）────────────────
// 两条独立的拖动条：宽度条向右拖增宽（固定左缘、右缘外扩），高度条向下拖增高
// （固定顶缘、底缘下延）。方向恒定直观，不依赖弹窗相对气泡的方位。
// pointerdown 记起点值 + 光标，window 级 move/up 拖动，live 写入 store（deep watch
// 统一落盘）。起点：已固化则用固化值，否则用弹窗当前实际值（拖一次即固化）
const RESIZE_MIN_W = 200; // 对齐 schema 的 floating_popover_width.min
const RESIZE_MIN_H = 120; // 对齐主面板的 RESIZE_MIN_H
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;
let resizeCleanup: (() => void) | null = null;

const releaseResize = () => {
  resizeCleanup?.();
};

const onWidthResizeStart = (e: PointerEvent) => {
  resizeStartX = e.clientX;
  resizeStartW =
    gs.settings.ui.floating_popover_width > 0
      ? gs.settings.ui.floating_popover_width
      : (popoverEl.value?.clientWidth ?? popoverWidth.value);
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - resizeStartX;
    // 固定左缘右扩：向右拖（dx 正）增宽
    const maxW = Math.min(720, window.innerWidth - 16);
    gs.settings.ui.floating_popover_width = Math.round(Math.min(maxW, Math.max(RESIZE_MIN_W, resizeStartW + dx)));
  };
  const onUp = () => releaseResize();
  resizeCleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    resizeCleanup = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

const onHeightResizeStart = (e: PointerEvent) => {
  resizeStartY = e.clientY;
  resizeStartH =
    gs.settings.ui.floating_popover_height > 0
      ? gs.settings.ui.floating_popover_height
      : (bodyEl.value?.clientHeight ?? 0);
  const onMove = (ev: PointerEvent) => {
    const dy = ev.clientY - resizeStartY;
    // 固定顶缘下延：向下拖（dy 正）增高
    const maxH = Math.min(1000, window.innerHeight * 0.9);
    gs.settings.ui.floating_popover_height = Math.round(Math.min(maxH, Math.max(RESIZE_MIN_H, resizeStartH + dy)));
  };
  const onUp = () => releaseResize();
  resizeCleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    resizeCleanup = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

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
    // 调整态下点击弹窗外 = 完成调整（退出调整态、不收起弹窗），与主面板「点击外部
    // = 完成调整」语义一致；正常态才走锁定/收起逻辑
    if (adjusting.value) {
      onToggleAdjust();
      return;
    }
    if (locked.value) return;
    closeBubbleOptions();
  };
  document.addEventListener('pointerdown', handler);
  cleanupDoc = () => document.removeEventListener('pointerdown', handler);
});

onUnmounted(() => {
  cleanupDoc?.();
  resizeCleanup?.();
});

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  // 调整态下 Esc = 完成调整（不收起弹窗），与主面板调整态一致
  if (adjusting.value) {
    onToggleAdjust();
    return;
  }
  if (!locked.value) closeBubbleOptions();
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
  /* 底部工具条高度单一来源（bar 的 min-height 引用） */
  --choice-float-bar-h: 40px;
  opacity: 1;
  transition: opacity 0.2s ease;
}

.choice-floating-options--dimmed {
  opacity: 0.45;
}

/* 选项区：限高内部滚动；触屏允许纵向平移，到顶/底后滚动链不传导给聊天页
   （与主面板 body 的分轴约定一致）。基础 max-height = 自动 55dvh；自定义高度
   与调整态固定高度由 bodyHeightStyle 内联覆盖（调整态 height 固定可感知） */
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

/* 底部工具条：贴外壳底，边框与列表区隔开；触屏按钮保证可点高度。
   min-height 用根容器的 --choice-float-bar-h（与 resize 把手 bottom 同源） */
.choice-floating-options-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: var(--choice-float-bar-h, 40px);
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

/* 工具条按钮本体（透明底/muted 图标/hover 底色/主色 main 变体/触屏抬升）
   全部走 global.css 的 .choice-tool-btn 原子，与主面板头部工具区同语言 */

/* 调整态字号档分段：复用 global.css 的 .choice-seg 语言，悬浮球内独立一份（视图私有展示态） */
.choice-floating-adjust-font {
  flex: 1;
  justify-content: flex-start;
}

/* 调整态拖动条区：选项 body 上方的一条横排，两条拖动条等宽；下边框与选项区隔开。
   窄屏自动换行（flex-wrap），不挤底部工具条 */
.choice-floating-adjust-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2) var(--choice-space-2) 0;
  border-bottom: 1px solid var(--choice-border-strong);
}

/* 单个拖动条：可点热区（图标 + 文案），pointer drag 改对应尺寸。
   touch-action:none + user-select:none 保证触屏/文字不干扰拖动手势 */
.choice-float-adjust-grip {
  flex: 1;
  min-width: 120px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.choice-float-adjust-grip:hover {
  color: var(--choice-primary);
  border-color: var(--choice-border-active);
}
.choice-float-adjust-grip i {
  pointer-events: none;
}
</style>
