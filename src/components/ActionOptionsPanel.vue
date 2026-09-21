<template>
  <div
    v-show="visible"
    ref="panelEl"
    class="choice-panel"
    :class="{
      'choice-panel--compact': compact,
      'choice-panel--dense': isDense,
      'choice-panel--docked': isDocked && !compact,
      'choice-panel--hud': hudEnabled,
    }"
    :style="[panelAdjustStyle, { '--choice-option-font-scale': optionFontScale }]"
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
        <!-- 润色视图：取消（loading）按钮 -->
        <button
          v-if="!adjusting && activeView === 'enrich' && enrichLoading"
          class="choice-tool-btn choice-tool-btn--main"
          :title="t`取消润色`"
          @click="onCancelEnrich"
        >
          <i class="fa-solid fa-stop"></i>
        </button>
        <!-- 润色视图：生成润色按钮 -->
        <button
          v-if="!adjusting && activeView === 'enrich' && !enrichLoading"
          class="choice-tool-btn choice-tool-btn--main"
          :title="t`生成润色`"
          @click="onTriggerEnrich"
        >
          <i class="fa-solid fa-wand-magic-sparkles"></i>
        </button>
        <!-- 选项视图：生成按钮（图标态，折叠/展开靠点标题栏） -->
        <button
          v-if="!adjusting && activeView === 'options'"
          class="choice-tool-btn choice-tool-btn--main"
          :title="isGenerating ? t`取消生成` : t`生成选项`"
          @click="onToggle"
        >
          <i :class="isGenerating ? 'fa-solid fa-stop' : 'fa-solid fa-wand-magic-sparkles'"></i>
        </button>
        <!-- 面板状态锁：锁定后自动化（生成后展开/点选项收起/发消息收起）全部跳过，
             面板常开/常关；手动切换仍有效且锁定跟随新状态。持久化于 ui.panel_lock -->
        <button
          v-if="!adjusting"
          class="choice-tool-btn"
          :class="{ 'choice-tool-btn--active': locked }"
          :title="locked ? t`解锁面板状态` : t`锁定面板状态（不再自动展开/收起）`"
          @click="onToggleLock"
        >
          <i :class="locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
        </button>
        <!-- 主题循环切换：每点一次切到 THEME_OPTIONS 中的下一个主题（末尾回绕）。
             全局生效并持久化（gs.settings.ui.theme_mode），tooltip 明示下一站避免盲切 -->
        <button v-if="!adjusting" class="choice-tool-btn" :title="cycleTitle" @click="onCycleTheme">
          <i class="fa-solid fa-palette"></i>
        </button>
        <!-- 调整模式：进入后面板显示字号档与高度拖动区（选项禁用，避免调整时误点）。
             放在设置入口左侧：生成/锁定/主题等高频操作仍按原顺序靠左，调整不抢位 -->
        <button
          v-if="!compact"
          class="choice-tool-btn choice-tool-btn--adjust"
          :class="{ 'choice-tool-btn--active': adjusting }"
          :title="adjusting ? t`完成调整` : t`调整面板大小与字号`"
          @click="onToggleAdjust"
        >
          <i class="fa-solid fa-sliders"></i>
        </button>
        <!-- 设置入口：恒在工具区最右（与生成/锁定/主题并列），点开插件设置面板。
             与悬浮球/魔棒菜单共用 openSettings 同一开关；tools 容器已 @click.stop，
             不会误触标题栏折叠 -->
        <button v-if="!adjusting" class="choice-tool-btn" :title="t`打开设置`" @click="onOpenSettings">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
      <!-- 生成/润色进行中的动效：跑在标题栏下边缘（2px 光带），不撑开 body——
           收起时面板就是一条栏，动效正落在"折叠后的栏"上；展开时旧选项保持可见不闪烁 -->
      <div v-if="isGenerating || enrichLoading" class="choice-panel-progress"></div>
    </div>

    <!-- 调整态工具条：进入调整模式后显示在标题栏下方（内容上边界），承载高度拖动 + 面板字号档。
         选项在调整态已禁用点击，半透明/覆盖到选项上方也不影响操作；不随 body 滚动 -->
    <div v-if="adjusting && !compact" class="choice-panel-adjust-bar">
      <div
        class="choice-panel-adjust-grip"
        :title="t`向上拖面板往上变高，向下拖变矮（底部固定）`"
        @pointerdown.stop.prevent="onResizeStart"
      >
        <i class="fa-solid fa-arrows-up-down"></i>
        <span class="choice-panel-adjust-hint">{{ t`面板高度` }}：{{ heightHint }}</span>
      </div>
      <div class="choice-panel-adjust-font choice-seg">
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
    </div>

    <!-- 生成/润色进行中且无旧结果时 body 整体不渲染（面板收缩为一条标题栏，动效在上面跑）；
         有旧结果时保持展开，旧选项在等待期间不闪烁 -->
    <div v-if="bodyShown" ref="bodyEl" class="choice-panel-body" :style="bodyHeightStyle">
      <template v-if="visibleOptions.length > 0">
        <!-- 行为栏：统一走 global.css 的 .choice-seg 分段控件语言（发送/覆盖/尾附/插入）。
             调整态隐藏（调整态只留字号+拖动，避免误触发行为） -->
        <div v-if="!compact && !adjusting" class="choice-seg">
          <button
            class="choice-seg-btn"
            :class="{ active: behavior === 'send' }"
            :title="t`点击选项后发送消息`"
            @click="behavior = 'send'"
          >
            {{ t`发送` }}
          </button>
          <button
            class="choice-seg-btn"
            :class="{ active: behavior === 'fill' }"
            :title="t`点击选项后填入输入框`"
            @click="behavior = 'fill'"
          >
            {{ t`覆盖` }}
          </button>
          <button
            class="choice-seg-btn"
            :class="{ active: behavior === 'append' }"
            :title="t`点击选项后追加到输入框末尾`"
            @click="behavior = 'append'"
          >
            {{ t`尾附` }}
          </button>
          <button
            class="choice-seg-btn"
            :class="{ active: behavior === 'insert' }"
            :title="t`点击选项后插入到输入框光标处`"
            @click="behavior = 'insert'"
          >
            {{ t`插入` }}
          </button>
          <!-- 分页器移出头部，贴行为栏最右：仅多组结果时显示（1/1 纯噪音）。
               enrich 视图无独立分页行——行为栏在两视图共用，按视图切换右侧分页组，
               头部两视图统一只剩 [生成][锁][调色板] -->
          <span v-if="activeView === 'options' && generations.length > 1" class="choice-bar-pager">
            <button class="choice-tool-btn" :disabled="currentIndex <= 0" title="上一组" @click="onPrev">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span class="choice-panel-pager">{{ currentIndex + 1 }}/{{ generations.length }}</span>
            <button
              class="choice-tool-btn"
              :disabled="currentIndex >= generations.length - 1"
              title="下一组"
              @click="onNext"
            >
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </span>
          <span v-else-if="activeView === 'enrich' && enrichGenerations.length > 1" class="choice-bar-pager">
            <button class="choice-tool-btn" :disabled="enrichCurrentIndex <= 0" title="上一组" @click="onEnrichPrev">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span class="choice-panel-pager">{{ enrichCurrentIndex + 1 }}/{{ enrichGenerations.length }}</span>
            <button
              class="choice-tool-btn"
              :disabled="enrichCurrentIndex >= enrichGenerations.length - 1"
              title="下一组"
              @click="onEnrichNext"
            >
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </span>
          <!-- 风险档位图例：HUD 开启且当前代存在带档位标注的选项时显示。
               原生 title tooltip（触屏长按可见），不占用常驻布局 -->
          <span v-if="hasGradedOptions" class="choice-icon-hint" :title="legendTitle">
            <i class="fa-solid fa-circle-info"></i>
          </span>
        </div>
        <button
          v-for="(option, index) in visibleOptions"
          :key="`${generationId}:${index}`"
          class="choice-option-btn"
          :class="optionBtnClass(option, index)"
          :style="optionBtnStyle(index)"
          :disabled="adjusting"
          @click="onSelect(option, index)"
        >
          <span class="choice-option-type">{{ parseOptionType(option.text) }}</span><!--
          --><span
            v-if="activeView === 'options' && rateOf(option) !== null"
            class="choice-option-rate"
            :class="rateClass(rateOf(option)!)"
            >{{ rateOf(option) }}%</span
          >
          <span class="choice-option-content"
            >{{ parseOptionContent(option.text)
            }}<i v-if="rollOf(index)" class="choice-roll-chip" :class="`choice-roll-chip--${rollOf(index)}`">{{
              rollLabel(rollOf(index)!)
            }}</i></span
          >
        </button>
        <div v-if="!compact && activeView === 'options' && underflow" class="choice-panel-hint">
          {{ t`本轮选项少于设定数量` }}
        </div>
      </template>
      <!-- 空态防闪：此前由 body 内 loading 分支挡住，动效迁移到标题栏后必须自守——
           生成中不得闪现"点击生成按钮获取选项" -->
      <div v-else-if="!isGenerating && !enrichLoading" class="choice-panel-empty">
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
import { openSettings } from '@/core/floating-state';
import { useCompactLayout } from '@/components/shared/useCompactLayout';
import { openApiOnboarding, autoOpenApiOnboarding } from '@/core/onboarding';
import { parseOptionType, parseOptionContent, parseOptionStyle, resolveOptionSuccessRate } from '@/util/option-format';
import { applyOptionBehavior } from '@/util/option-action';
import type { DiceOutcome } from '@/core/dice';

const props = defineProps<{ compact?: boolean }>();

// 点选选项完成（填入/发送等行为已执行）后发出；主面板（panel-mount 挂载）无人监听，
// 悬浮球选项 popover（FloatingOptions.vue）借此在选中后自动收起
const emit = defineEmits<{ select: [] }>();

const panelEl = ref<HTMLElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);
// 窄容器（手机聊天区 <420px）时收紧排版并限高滚动。与 compact prop 是两套机制：
// compact 是悬浮预览的极简形态（连头部管理件都省掉），dense 只压密度不减功能
const { isCompact: isDense } = useCompactLayout(panelEl);

const panelStore = usePanelStateStore();
const {
  messageId,
  visibleOptions,
  currentIndex,
  generations,
  activeView,
  enrichLoading,
  enrichGenerations,
  enrichCurrentIndex,
  hasEnrichHistory,
  collapsed,
} = storeToRefs(panelStore);

const isGenerating = computed(() => generatorState.loading);

const gs = useGlobalSettingsStore();

// ── 调整模式（组件内存态，不持久化）─────────────────────────────────────────────
// 标题栏「调整」按钮进入：选项与行为栏禁用、仅显示字号档与高度拖动条，退出即恢复。
// 正常态面板保持干净布局，不显示任何调整控件
const adjusting = ref(false);
// 调整态面板改绝对定位、底部锚定（往上长）：面板增高时顶部向上抬升、底部与下方
// 输入框都不动，拖动把手随光标走。进入时记录父容器并让它保留面板原高——面板脱离
// 文档流后，下面内容不会因增高而跳动。退出时全部还原
let adjustHost: HTMLElement | null = null;
let adjustPanelHeight = 0;
const releaseAdjustAnchor = () => {
  if (adjustHost) {
    adjustHost.style.position = '';
    adjustHost.style.height = '';
    adjustHost.style.overflow = '';
    adjustHost = null;
  }
  adjustPanelHeight = 0;
};
const onToggleAdjust = async () => {
  if (!adjusting.value) {
    // 进入调整态：先展开面板，等渲染完成后用面板当前高度/位置作为底部锚定基准
    panelStore.setCollapsed(false);
    await nextTick();
    const host = panelEl.value?.parentElement;
    if (host && panelEl.value) {
      adjustHost = host;
      adjustPanelHeight = panelEl.value.getBoundingClientRect().height;
      host.style.position = 'relative';
      host.style.height = `${adjustPanelHeight}px`;
      host.style.overflow = 'visible';
    }
  } else {
    // 退出调整：只还原父容器样式，不做任何滚动跳转，面板保留在原处
    releaseAdjustAnchor();
  }
  adjusting.value = !adjusting.value;
};
// 调整态面板定位：绝对定位、底部锚定在父容器底、宽度铺满；body 高度增高时面板
// 整体变高、顶部越过父容器上界向上抬升（往上长），把手随光标
const panelAdjustStyle = computed(() => {
  if (!adjusting.value) return {};
  return { position: 'absolute', bottom: '0', left: '0', right: '0' } as const;
});

const adjustFontOptions = [
  { value: 'auto' as const, label: t`自动`, tip: t`跟随全局字体档（不额外缩放）` },
  { value: 'small' as const, label: t`小`, tip: t`选项面板内小号文字，手机端更紧凑` },
  { value: 'medium' as const, label: t`中`, tip: t`选项面板内默认文字大小` },
  { value: 'large' as const, label: t`大`, tip: t`选项面板内大号文字，阅读更舒适` },
];
const isAdjustFontActive = (v: (typeof adjustFontOptions)[number]['value']) =>
  v === 'auto'
    ? gs.settings.ui.option_font_size_auto
    : !gs.settings.ui.option_font_size_auto && gs.settings.ui.option_font_size === v;
const applyAdjustFont = (v: (typeof adjustFontOptions)[number]['value']) => {
  if (v === 'auto') {
    gs.settings.ui.option_font_size_auto = true;
    return;
  }
  gs.settings.ui.option_font_size = v;
  gs.settings.ui.option_font_size_auto = false;
};
// 当前面板高度提示：0 = 自动（45/40dvh 上限），>0 = 已固化的 px
const heightHint = computed(() => {
  const h = gs.settings.ui.option_panel_height;
  return h > 0 ? `${h}px` : t`自动`;
});

// ── 选项面板正文独立字号档（ui.option_font_size / option_font_size_auto）─────────
// 只在全局 --choice-text-* 之上再乘一个面板档位（global.css 对 .choice-option-* 生效），
// 不与全局 font_size 联动；自动档 = 不额外缩放（跟随全局结果）
const OPTION_FONT_SCALE: Record<'small' | 'medium' | 'large', number> = { small: 0.85, medium: 1, large: 1.2 };
const optionFontScale = computed(() => {
  const ui = gs.settings.ui;
  return ui.option_font_size_auto ? 1 : OPTION_FONT_SCALE[ui.option_font_size];
});

// 面板 body 是否渲染（原内联条件提取为 computed，供 body 渲染判断）
const bodyShown = computed(
  () =>
    (props.compact || !collapsed.value) &&
    (visibleOptions.value.length > 0 || !(isGenerating.value || enrichLoading.value)),
);

// 面板栏高样式：分态——调整态用固定 height（内容不足时下方露留白、随拖动实时变化，
// 让设定高度可感知）；正常态用 max-height 收紧（选项少只撑到内容高度，不露空白）。
// h<=0 = 自动（沿用 45/40dvh 上限），返回空对象走 CSS 规则。
// 调整态必须显式 maxHeight:'none'：body 的 CSS 恒带 max-height:45/40dvh，inline height
// 会被其钳制到 ~400px，400px 以上拖动 store 上涨但视图不动（不跟手/区间无增长）
const bodyHeightStyle = computed(() => {
  const h = gs.settings.ui.option_panel_height;
  if (h <= 0) return {};
  return adjusting.value ? { height: `${h}px`, maxHeight: 'none' } : { maxHeight: `${h}px` };
});

// 选项 HUD 化总开关（外观页「聊天界面」分区）：关闭时分级色条/悬停增强/滑入动画/已选
// 打勾整体停用，选项回到基础卡片样式。AI 输出侧档位标注仍可存在，关闭时按中性显示
const hudEnabled = computed(() => gs.settings.ui.hud_enabled);

// 已选打勾：同一代内点过的选项加 ✓ 并半透明（纯视觉反馈，不持久化、不影响统计口径）。
// key 用「generation id + 行号」而非选项文本——文本会跨代重复，label 会误标未点过的
const selectedKeys = ref<ReadonlySet<string>>(new Set());
const currentEnrichGen = computed(() => panelStore.currentEnrichGeneration);
const generationId = computed(() =>
  activeView.value === 'enrich'
    ? (currentEnrichGen.value?.id ?? 'enrich')
    : (panelStore.currentGeneration?.id ?? 'none'),
);
const markOptionSelected = (index: number) => {
  const key = `${generationId.value}:${index}`;
  if (selectedKeys.value.has(key)) return;
  selectedKeys.value = new Set(selectedKeys.value).add(key);
};

// 档位 → 选项行样式类（theme.css 的 --choice-risk-* 别名；无档位不加类 = 中性）。
// 关闭 HUD 时全部不加，基础卡片样式不变
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

// 逐条滑入延迟（staggered 60ms/条）；HUD 关闭时动画整体停用（CSS 由 --hud 类门控）
const optionBtnStyle = (index: number): Record<string, string> => {
  if (!hudEnabled.value) return {};
  return { animationDelay: `${index * 60}ms` };
};

// 骰子判定（v55）：成功率徽标与行内判定 chip 的总开关（独立于 HUD 开关）。
// 徽标显示规则 = 骰子开 + 选项可解析出成功率（AI 标注或档位兜底），且仅选项视图
// （润色视图不掷骰，也不显示成功率，口径与 option-action.ts 判定分支一致）
const diceEnabled = computed(() => gs.settings.dice.enabled);
const rateOf = (option: ChoiceOption): number | null =>
  diceEnabled.value ? resolveOptionSuccessRate(option.text) : null;
// 徽标语义色按把握分档：高（≥70）绿 / 中（40-69）蓝 / 低（<40）橙——
// 与风险档位色条（表达风险）语义不同，不混用 --choice-risk-*
const rateClass = (rate: number): string =>
  rate >= 70 ? 'choice-option-rate--high' : rate >= 40 ? 'choice-option-rate--mid' : 'choice-option-rate--low';

// 行内判定反馈：同代内点过的选项记一次判定结局（纯视觉，不持久化），
// key 用「generation id + 行号」，切代/翻页自然失效（同 selectedKeys 机制）
const rollResults = ref<ReadonlyMap<string, DiceOutcome>>(new Map());
const rollOf = (index: number): DiceOutcome | null => rollResults.value.get(`${generationId.value}:${index}`) ?? null;
const rollLabel = (o: DiceOutcome): string =>
  o === 'crit_success' ? t`大成功` : o === 'crit_fail' ? t`大失败` : o === 'success' ? t`成功` : t`失败`;

// 风险档位图例：仅选项视图且存在带档位标注的选项时显示（enrich 视图不带档位）
const hasGradedOptions = computed(
  () =>
    activeView.value === 'options' &&
    hudEnabled.value &&
    visibleOptions.value.some(o => parseOptionStyle(o.text) !== null),
);
const legendTitle = computed(
  () => t`风险档位：保守（绿）/ 平衡（蓝）/ 大胆（橙）` + (diceEnabled.value ? t`；成功率徽标为骰子判定需求值` : ''),
);

// 与 generateOptions 内部同一套 API 校验：口径一致（空状态按钮的显隐、生成的
// 前置拦截都看它），避免"按钮亮了但生成报未配置"的分裂。
// gs 必须先于 apiReady 声明：getter 引用 gs，computed 惰性求值使当前运行时安全，
// 但顺序倒置一旦有人同步读取 apiReady.value 就踩暂时性死区
const apiReady = computed(() => !!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis));

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

// 工具区最右的设置按钮：直接复用悬浮球/魔棒菜单的同一开关，避免两套面板状态
const onOpenSettings = () => {
  openSettings();
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

// ── 点击聊天正文收起（ui.panel_collapse_on_outside_click，默认关）───────────────
// 只把「展开的面板」在用户点击聊天区内普通正文/空白时收起（不反向弹开，降低误触）。
// 触发范围收窄到 #chat 内：手机端整屏都是聊天文字，**不排除 .mes 本体**——点气泡
// 正文/空白即可收起；同时**不误伤其他插件的浮动面板**（其 DOM 通常挂 body/顶层容器、
// 不在 #chat 内，一律不收起、也不吞其首击）。
// 仅排除 #chat 内的交互/复制目标（链接、按钮、图片、输入区、工具栏等），点它们不触发。
// compact（悬浮预览）不参与。
// 收起由 pointerdown 触发，同一手势随后的 click 会命中「面板收起后露出的下层元素」，
// 必须吃掉该次 click（capture + once + 超时兜底），避免塌陷穿透点中下面的消息/按钮。
// 因折叠分支只对 #chat 内目标可到达，被吞的 click 只可能是聊天正文/被塌陷盖住的
// 聊天内容，属合理防穿透；外来悬浮窗点击永不进入本分支，首击不被吞。
const OUTSIDE_EXCLUDE_SELECTOR = [
  '#send_form',
  '#send_textarea',
  '#choice_enrich_btn',
  '.choice-floating-bubble',
  '.choice-floating-options',
  '.choice-floating-context',
  '.choice-floating-overlay',
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'label',
  'img',
  'video',
  'audio',
  'pre',
  'code',
  '[role="button"]',
  '[contenteditable="true"]',
  '.menu_button',
  '.interactable',
  '.mes_edit',
  '.mes_action',
  '.mes_buttons',
  '.mes_img',
].join(',');
let outsideClickClickCleanup: (() => void) | null = null;

const onDocumentPointerDown = (e: PointerEvent) => {
  if (props.compact) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const inPanel = (panelEl.value?.contains(target) ?? false) as boolean;
  // 调整态：点击面板外任意处 = 完成调整（退出调整模式），与「点击聊天正文收起」开关
  // 无关；面板内点击（选项已禁用）保持调整中。拖动把手在 grip 上有 pointerdown.stop，
  // 不冒泡到此，正在拖高度时不会误退
  if (adjusting.value) {
    if (!inPanel) {
      void onToggleAdjust();
    }
    return;
  }
  if (!gs.settings.ui.panel_collapse_on_outside_click) return;
  if (!visible.value || collapsed.value) return;
  if (inPanel) return;
  // 只对聊天区（#chat）内的目标生效：点其他插件浮动面板（DOM 多在 #chat 外）一律
  // 不收起、不吞其 click，避免误伤；.mes 在 #chat 内，点正文/空白仍可收起
  const chatEl = document.getElementById('chat');
  if (!chatEl || !chatEl.contains(target)) return;
  if (target.closest(OUTSIDE_EXCLUDE_SELECTOR)) return;
  // 手动收起路径：锁定态也生效并回写 panel_lock（同点标题栏折叠箭头的语义）
  panelStore.setCollapsed(true);
  // 吃同手势的 click：capture 阶段拦截，once 自移除 + 超时兜底（无 click 的 pointercancel）
  const clickHandler = (ce: MouseEvent) => {
    outsideClickClickCleanup?.();
    ce.stopPropagation();
    ce.preventDefault();
  };
  outsideClickClickCleanup = () => {
    document.removeEventListener('click', clickHandler, true);
    outsideClickClickCleanup = null;
  };
  document.addEventListener('click', clickHandler, { capture: true, once: true });
  setTimeout(() => outsideClickClickCleanup?.(), 500);
};

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  outsideClickClickCleanup?.();
  resizeCleanup?.();
  releaseAdjustAnchor();
});

// ── 面板栏高拖动（ui.option_panel_height，0 = 自动 vh 上限）──────────────────────
// pointerdown 记起点与起点高度，window 级 move/up 拖动；live 写入 store（深度 watch
// 统一落盘）。起点高度：已固化则用固化值，否则用 body 当前实际高（拖一次即固化）。
// 方向（配合调整态的底部锚定）：把手在面板顶部、面板底部固定——向上拖（dy 为负）
// 增高、顶部上抬（往上长）；向下拖（dy 为正）变矮。公式用减号，把手随光标走
const RESIZE_MIN_H = 120;
let resizeStartY = 0;
let resizeStartH = 0;
let resizeCleanup: (() => void) | null = null;

const onResizeStart = (e: PointerEvent) => {
  if (props.compact) return;
  resizeStartY = e.clientY;
  const stored = gs.settings.ui.option_panel_height;
  resizeStartH = stored > 0 ? stored : (bodyEl.value?.getBoundingClientRect().height ?? 300);
  const onMove = (ev: PointerEvent) => {
    // 上限与 schema 的 .max(1000) 对齐：超出会在下次加载 zod fail 被 .catch(0) 重置
    const maxAllowed = Math.min(1000, window.innerHeight * 0.9);
    const next = Math.min(maxAllowed, Math.max(RESIZE_MIN_H, resizeStartH - (ev.clientY - resizeStartY)));
    gs.settings.ui.option_panel_height = Math.round(next);
  };
  const onUp = () => {
    resizeCleanup?.();
  };
  resizeCleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    resizeCleanup = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

const visible = computed(() => {
  // 聊天界面选项面板开关：关闭时整组隐藏（popover 等入口不受影响）。放在最前，
  // 关闭状态下连带加载/生成中也不渲染——组件保持挂载，store 数据仍由 panel-mount 同步
  if (!gs.settings.ui.chat_panel_enabled) {
    return false;
  }
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

const onSelect = async (option: ChoiceOption, index: number) => {
  // view 标记来源：统计口径仅行动选项视图计入，润色视图的选择不计数（见 option-action.ts）；
  // poolEntryIds/generationId 取被点选项所在代（currentGeneration=generations[currentIndex]，
  // 翻页后正确；generationId 用于同代重复点击的命中去重）
  const isEnrich = activeView.value === 'enrich';
  const gen = isEnrich ? null : panelStore.currentGeneration;
  const dice = await applyOptionBehavior(option, behavior.value, {
    view: isEnrich ? 'enrich' : 'options',
    poolEntryIds: gen?.poolEntryIds ?? [],
    generationId: gen?.id,
    matchedEntryId: option.matchedEntryId,
    scopeId: gen?.scopeId,
  });
  // 行内判定 chip（v55 骰子结果；润色视图恒返回 null，不标记）
  if (dice) {
    rollResults.value = new Map(rollResults.value).set(`${generationId.value}:${index}`, dice.outcome);
  }
  // 已选打勾（HUD 视觉反馈）：选中成功后才标记，与统计口径无关
  markOptionSelected(index);
  // 锁定展开时点选项后面板不收起（常开）
  panelStore.autoSetCollapsed(true);
  emit('select');
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
  /* 生成/润色动效光带的定位基准（绝对定位贴 header 底边） */
  position: relative;
}

.choice-panel-title {
  font-size: var(--choice-text-sm);
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

.choice-panel-pager {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 2px;
}

.choice-panel-body {
  display: flex;
  flex-direction: column;
  /* 条目间距取最小档 4px：极简方向下选项列表是纯 stacked 列表，8px 的呼吸感
     让 N 条选项多占一条的视觉高度；行为栏与选项之间同距即可，无需分层 */
  gap: var(--choice-space-1);
  padding: var(--choice-space-2) var(--choice-space-3) var(--choice-space-3);
  /* 必须显式恢复 normal：停靠模式下面板挂在 #form_sheld 内，ST 对它声明了
     white-space:nowrap 并一路继承进选项文本——选项全部单行溢出，body 的
     overflow-x:auto 冒出横向滚动条（聊天内模式挂在 #chat 下无此继承，从未暴露）。
     需要 nowrap 的元素（behavior-btn/option-type）在下方均有显式声明，不受影响 */
  white-space: normal;
}

/* 非悬浮预览（compact）形态：选项多时始终限高内部滚动，限高触发的唯一条件是
   "内容超出"，与设备 pointer 类型或容器宽度无关。这是 dense 未激活时的兜底——
   Bluestacks5 等模拟器报告 pointer: fine 且容器宽度 >=420px 时 useCompactLayout
   不触发 dense，此前 .choice-panel-body 无 max-height，被 #chat 的 overflow-y:scroll
   接管，用户在选项栏内滑动时拖动的是酒馆聊天页而非选项栏内部（划不动的主因）。
   compact（悬浮预览极简卡）排除：其尺寸由 popover 外壳约束，且选项通常很少 */
.choice-panel:not(.choice-panel--compact) .choice-panel-body {
  /* 同 dvh 回退：手机上 vh 按布局视口取值可能超出可视高度 */
  max-height: 45vh;
  max-height: 45dvh;
  overflow-y: auto;
  /* 纵向到顶/底后允许滚动链传导给酒馆聊天页（继续滑可翻聊天记录），
     横向仍 contain 防止触发酒馆左右滑动手势（切回复/生成新回复）。
     此前 dense/docked 用 overscroll-behavior:contain 四轴全挡，到顶/底后
     滑动死在面板内、聊天页不跟随，体感像"卡住"；改为分轴后体验更顺滑 */
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
  /* 安卓部分 WebView 对 overflow:auto 容器未声明 touch-action 时不把触摸识别为
     滚动意图，用户只能拖右侧滚动条；pan-y 仅放行纵向平移，不影响横向滚动/缩放 */
  touch-action: pan-y;
  /* 旧安卓 WebView 需此属性才启用惯性平滑滚动，新浏览器自动忽略，无副作用 */
  -webkit-overflow-scrolling: touch;
  /* 细滚动条 + 主题色，避免默认粗滚动条挤占选项宽度 */
  scrollbar-width: thin;
  scrollbar-color: var(--choice-border-strong) transparent;
}

/* ===== 调整态工具条（标题栏下方，进入调整模式后显示）=====
   半透明背景覆盖在选项之上也无妨（选项已禁用）；拖动区做足触摸高度，
   手机用户不用摸到列表底部。字号档走 .choice-seg 原子，与全局语言一致 */
.choice-panel-adjust-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  padding: 4px var(--choice-space-3);
  border-bottom: 1px solid var(--choice-border);
  background: var(--choice-bg-element);
}

.choice-panel-adjust-grip {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  min-height: 40px;
  cursor: ns-resize;
  touch-action: none;
  color: var(--choice-text-secondary);
  -webkit-user-select: none;
  user-select: none;
}

.choice-panel-adjust-grip:hover {
  color: var(--choice-primary);
}

.choice-panel-adjust-hint {
  font-size: var(--choice-text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.choice-panel-adjust-font {
  flex-shrink: 0;
}

.choice-panel-adjust-font .choice-seg-btn {
  min-height: 32px;
  padding: 4px 10px;
}

/* 调整态：选项禁用态视觉（disabled 按钮无默认 pointer-events 屏蔽，需显式降透明显弱） */
.choice-option-btn:disabled {
  opacity: 0.55;
  pointer-events: none;
}

/* 生成/润色进行中：光带贴标题栏下边缘跑动（bottom:-1px 盖住 1px 底边框线）。
   动效从 body 内独立块迁来——此前会撑开一块区域"跳出"动效，现收在栏上，
   面板收起时正落在唯一可见的标题栏上 */
.choice-panel-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    transparent 40%,
    rgba(var(--choice-primary-rgb), 0.55) 50%,
    transparent 60%,
    transparent 100%
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

/* 行为栏右端分页器：margin-left:auto 顶到最右，箭头按钮收窄并降到栏内字号，
   与行为词同密度（行为按钮本体走 global.css 的 .choice-seg/.choice-seg-btn 原子） */
.choice-bar-pager {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.choice-bar-pager .choice-tool-btn {
  padding: 2px var(--choice-space-1);
  font-size: var(--choice-text-xs);
}

.choice-bar-pager .choice-panel-pager {
  margin: 0;
}

/* ===== 窄容器密度模式（useCompactLayout，<420px）=====
   只压密度不减功能：手机聊天区里 4 条选项 × 每条 2-4 行 + 头部 + 行为栏，展开常占半屏。
   类型徽标已随选项行统一为自适应 inline（见 global.css），dense 只收行高；
   触控按钮保住 32px 最小可点高度（上一段规则），密度让给内容区而不是可点性。
   限高滚动只在此模式生效——桌面无高度压力，不引入嵌套滚动 */
.choice-panel--dense .choice-panel-header {
  padding: var(--choice-space-1) var(--choice-space-2);
}

.choice-panel--dense .choice-panel-body {
  /* max-height/overflow/touch-action/overscroll 由基础规则
     (.choice-panel:not(--compact) .choice-panel-body) 提供，dense 仅压密度；
     gap 已随基础层下沉为 4px，dense 无需再覆盖 */
  /* 右侧 padding 加宽一档：滚动条不再紧贴面板右边缘，提升触屏命中率 */
  padding: var(--choice-space-2) var(--choice-space-3) var(--choice-space-2);
}

.choice-panel--dense .choice-option-btn {
  line-height: 1.3;
}

.choice-panel--dense .choice-option-content {
  line-height: 1.3;
}

.choice-panel--dense .choice-panel-hint {
  padding-top: 0;
}

/* 抬头压缩：coarse 规则的 40px 触控高度 + 工具区满编（翻页/生成/锁/调色板）
   会把"行动选项"标题挤成两行，抬头反而更高。dense 下牺牲部分可点高度（40→32px）
   换单行抬头；特异性 (0,2,0) 高于 coarse 规则 (0,1,0)，无论书写顺序都由 dense 取胜 */
.choice-panel--dense .choice-panel-header {
  gap: var(--choice-space-1);
}

.choice-panel--dense .choice-panel-title {
  white-space: nowrap;
}

.choice-panel--dense .choice-tool-btn {
  min-height: 32px;
}

/* 行为栏：触屏 coarse 下按钮 40px 高 + 容器 padding 使整条约 48px，小屏上与选项争高度；
   dense 下按钮 30px 把整条压矮（基础 padding 已收紧，dense 不再重复覆盖间距） */
.choice-panel--dense .choice-seg-btn {
  min-height: 30px;
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
  /* 仅覆盖限高为 40dvh（比基础 45dvh 略矮：停靠面板恒在可视区内，少占屏）。
     overflow/touch-action/overscroll 由基础规则提供，不在此重复——此前 dock 块
     用 overscroll-behavior:contain 覆盖了基础的分轴值，到顶/底后死在面板内，
     现统一交给基础的分轴规则，体验一致 */
  max-height: 40vh;
  max-height: 40dvh;
}
</style>
