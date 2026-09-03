import { computed, ref } from 'vue';
import type { TabId } from '@/components/shared/tab-definitions';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { pinia } from '@/pinia';
import { openSettings } from '@/core/floating-state';
import { GUIDE_CHAPTERS } from '@/core/guide-content';

/** 向导弹窗可见性。向导是全局单实例（挂在 FloatingRoot），不挂在行内/悬浮面板内——
 *  行内面板常驻挂载而悬浮面板内容 v-if，若各挂一份实例，共享同一 ref 会让
 *  Teleport 到 body 的弹窗/遮罩渲染两份（遮罩叠深、DOM 翻倍） */
export const onboardingVisible = ref(false);

/** 功能课堂章节菜单可见性。🎓 按钮不再直接从第 1 步重放整个向导，而是先开菜单
 *  让用户挑章节；菜单与步骤视图互斥显示，closeOnboarding 两个一起关 */
export const onboardingMenuVisible = ref(false);

/** 向导「切换 tab」的待处理信号。向导是全局单实例，不知道当前面板的 activeTab，
 *  由打开中的面板 watch 消费后置回 null */
export const onboardingPendingTab = ref<TabId | null>(null);

/**
 * 向导「弹窗状态」信号。条目库、选择条目、正则库弹窗的开关状态分散在
 * PoolEditor / FilterEditor 的本地 ref 里，向导无法直接置位——按归属分发给
 * 持有状态的组件消费（见各组件的 watch）。
 *
 * 语义是"本步应有的完整弹窗状态"而非"开某个弹窗"的增量动作：close-all 表示
 * 全部归零。这样点「上一步」时界面能完整回到上一步该有的样子——若只发增量
 * （如 pool-library 只管开条目库），从"选择条目"回退到"条目库"时选择条目
 * 弹窗还开着叠在上面，用户看到的就是"没回到上一步的界面"
 */
export type OnboardingAction = 'close-all' | 'pool-library' | 'pool-select-entries' | 'filter-library';
export const onboardingPendingAction = ref<OnboardingAction | null>(null);

/** 当前步骤下标（章内）。翻页只改这里，组件 watch 它驱动「切 tab → 开弹窗 → 等渲染 → 聚焦」链路 */
export const onboardingStepIndex = ref(0);

/** 当前章 id。步骤数据本体在 guide-content.ts 的 GUIDE_CHAPTERS，组件经此 computed 读取 */
export const onboardingChapterId = ref<string>('quick-start');

export const onboardingChapter = computed(
  () => GUIDE_CHAPTERS.find(c => c.id === onboardingChapterId.value) ?? GUIDE_CHAPTERS[0],
);

export interface OnboardingStep {
  id:
    | 'welcome'
    | 'api-fill'
    | 'api-save'
    | 'pool-ready'
    | 'pool-concept'
    | 'pool-open'
    | 'pool-add'
    | 'pool-select'
    | 'gen-auto'
    | 'gen-behavior'
    | 'gen-count'
    | 'prompt-intro'
    | 'wi-enable'
    | 'wi-exclude'
    | 'wi-books'
    | 'filter-zones'
    | 'filter-library-open'
    | 'filter-st-import'
    | 'filter-reference'
    | 'appearance-panel'
    | 'appearance-theme'
    | 'run-generate'
    | 'done';
  icon: string;
  title: string;
  html: string;
  /** 进入本步时自动切到的 tab（经 onboardingPendingTab 间接下发） */
  tab?: TabId;
  /** 进入本步时下发的弹窗状态信号（经 onboardingPendingAction 间接下发） */
  action?: OnboardingAction;
  /** 聚光灯目标：data-tour 属性选择器。目标元素找不到（tab 未渲染/弹窗未开/
   *  被滚出视口）时向导自动退化为「整体调暗 + 卡片居中」，目标恢复后自动重新聚焦 */
  target?: string;
  /**
   * 完成信号（返回 null = 本步无信号，手动翻页）。组件在进入本步时快照基线，
   * 仅当基线为 false 且运行中变为 true（"本步内从无到有"）才自动前进——
   * 全新档默认配置已含条目、老用户重放时 API 已配置，若不区分基线会秒跳
   */
  done?: () => boolean;
}

/** 打开章节菜单（tab 栏 🎓 按钮）。不带进度、无状态，纯导航 */
export function openChapterMenu(): void {
  onboardingVisible.value = false;
  onboardingMenuVisible.value = true;
}

/** 进入某章的某步（默认从第 1 步开始）。菜单 → 向导、欢迎卡 → 向导、召回 → 向导共用 */
function startChapter(chapterId: string, stepIndex = 0): void {
  onboardingMenuVisible.value = false;
  if (!GUIDE_CHAPTERS.some(c => c.id === chapterId)) return;
  onboardingChapterId.value = chapterId;
  onboardingStepIndex.value = stepIndex;
  onboardingVisible.value = true;
}

/** 手动重开：带章节 id 直接进入该章第 1 步；不带 id 打开章节菜单。
 *  不检查 done——调用方（🎓 按钮）就是给"想再看"的用户用的 */
export function openOnboarding(chapterId?: string): void {
  if (chapterId) startChapter(chapterId);
  else openChapterMenu();
}

/**
 * 直达「配置 API」召回：打开设置面板并把向导定位到 quick-start 的填 API 步
 * （跳过欢迎页——卡在 API 未配置的用户不需要再听一遍插件是什么）。
 * 不检查 onboarding_done：无论看过引导没有，被卡住的用户都该被送到解决路径上，
 * 置 done 只是为了之后不再自动打扰
 */
export function openApiOnboarding(): void {
  const gs = useGlobalSettingsStore(pinia);
  gs.settings.ui.onboarding_done = true;
  openSettings();
  startChapter('quick-start', 1);
}

/**
 * 生成被 API 未配置阻塞时的自动召回入口：每会话至多自动弹一次。
 * 重复弹会抢焦点——用户可能正在向导里填 API，此时再触发（比如润色/自动生成
 * 并发失败）只会把填了一半的表单切走；之后仅由调用方的 toastr 报错。
 * 手动入口（面板空状态「去配置 API」按钮）走 openApiOnboarding，不受此节流
 */
let autoRemedyShown = false;
export function autoOpenApiOnboarding(): void {
  if (autoRemedyShown) return;
  autoRemedyShown = true;
  openApiOnboarding();
}

/**
 * 设置面板打开时调用：从未看过引导则弹出快速上手章。弹出瞬间就置 done 而非关闭时置——
 * 用户中途刷新页面/直接杀进程也视为看过，避免每次打开设置都被向导拦截；
 * 想重看走 tab 栏 🎓 按钮（章节菜单）。done 写入 settings 后由 global-settings
 * store 的 deep watch 自动落盘
 */
export function maybeAutoOpenOnboarding(): void {
  const gs = useGlobalSettingsStore(pinia);
  if (gs.settings.ui.onboarding_done) return;
  gs.settings.ui.onboarding_done = true;
  startChapter('quick-start');
}

export function closeOnboarding(): void {
  onboardingVisible.value = false;
  onboardingMenuVisible.value = false;
}

/** 步骤切换 tab 用：只发信号不关向导（聚光灯导览中切页后继续停留在当前步） */
export function requestOnboardingTab(tab: TabId): void {
  onboardingPendingTab.value = tab;
}
