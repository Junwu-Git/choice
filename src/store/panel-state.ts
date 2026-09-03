import * as toastr from 'toastr';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { getMessageChoiceData, setMessageChoiceData, storeEnrichGeneration } from '@/core/options-store';
import type { ChoiceGeneration } from '@/core/options-store';
import { enrichUserInput } from '@/core/enrich-input';
import { useGlobalSettingsStore } from '@/store/global-settings';

export const usePanelStateStore = defineStore('panel-state', () => {
  const messageId = ref<number | null>(null);
  const swipeId = ref(0);
  const generations = ref<ChoiceGeneration[]>([]);
  const currentIndex = ref(0);

  /** 当前视图：选项或润色 */
  const activeView = ref<'options' | 'enrich'>('options');
  const enrichGenerations = ref<ChoiceGeneration[]>([]);
  const enrichCurrentIndex = ref(0);
  const enrichLoading = ref(false);
  const collapsed = ref(false);

  const gs = useGlobalSettingsStore();
  /** 面板状态锁（ui.panel_lock）：open/collapsed 时 4 处自动化点位全部跳过 */
  const locked = computed(() => gs.settings.ui.panel_lock !== 'off');
  // 初始恢复：锁定收起的面板在刷新后保持收起（'open' 时 collapsed 本就为 false，无需处理）。
  // 放在 store setup 里只执行一次——resync/load 高频触发，不能在那条路径上反复强制，
  // 否则锁定期间的手动切换会被下一次 resync 冲掉
  if (gs.settings.ui.panel_lock === 'collapsed') {
    collapsed.value = true;
  }

  /** 面板「生成润色」按钮被点击时设为 true，panel-mount 读取输入框后调用 triggerEnrich */
  const triggerEnrichRequested = ref(false);

  const currentGeneration = computed<ChoiceGeneration | null>(() => generations.value[currentIndex.value] ?? null);
  const currentEnrichGeneration = computed<ChoiceGeneration | null>(
    () => enrichGenerations.value[enrichCurrentIndex.value] ?? null,
  );
  const hasEnrichHistory = computed(() => enrichGenerations.value.length > 0);

  const visibleOptions = computed(() => {
    if (activeView.value === 'enrich') return currentEnrichGeneration.value?.options ?? [];
    return currentGeneration.value?.options ?? [];
  });
  const hasHistory = computed(() => generations.value.length > 0);

  const load = (message_id: number, swipe_id: number) => {
    const data = getMessageChoiceData(message_id, swipe_id);
    messageId.value = message_id;
    swipeId.value = swipe_id;
    generations.value = data?.generations ?? [];
    currentIndex.value = data?.currentIndex ?? Math.max(0, (data?.generations.length ?? 1) - 1);
    enrichGenerations.value = data?.enrichGenerations ?? [];
    enrichCurrentIndex.value = data?.enrichCurrentIndex ?? 0;
    if (activeView.value === 'enrich' && enrichGenerations.value.length === 0) {
      activeView.value = 'options';
    }
  };

  const clear = () => {
    messageId.value = null;
    swipeId.value = 0;
    generations.value = [];
    currentIndex.value = 0;
    enrichGenerations.value = [];
    enrichCurrentIndex.value = 0;
    enrichLoading.value = false;
    activeView.value = 'options';
    // 锁定收起时不得重置：clear 发生在空聊天/切聊天，重置为 false 后 load() 不会
    // 恢复，锁定收起会被静默破坏（面板在下一轮数据到来时闪开）
    if (!locked.value) {
      collapsed.value = false;
    }
  };

  const goTo = (index: number) => {
    if (index < 0 || index >= generations.value.length) {
      return;
    }
    currentIndex.value = index;
    setMessageChoiceData(messageId.value as number, swipeId.value, {
      generations: generations.value,
      currentIndex: index,
      enrichGenerations: enrichGenerations.value,
      enrichCurrentIndex: enrichCurrentIndex.value,
    });
  };

  const enrichGoTo = (index: number) => {
    if (index < 0 || index >= enrichGenerations.value.length) {
      return;
    }
    enrichCurrentIndex.value = index;
    setMessageChoiceData(messageId.value as number, swipeId.value, {
      generations: generations.value,
      currentIndex: currentIndex.value,
      enrichGenerations: enrichGenerations.value,
      enrichCurrentIndex: index,
    });
  };

  function setActiveView(view: 'options' | 'enrich') {
    activeView.value = view;
  }

  /** 完整润色流程：读输入框 → 调 API → 存储结果 → 切换到润色视图 */
  async function triggerEnrich(input: string) {
    if (messageId.value === null) {
      toastr.error(t`请先发送一条消息后再使用润色功能`);
      return;
    }
    enrichLoading.value = true;
    activeView.value = 'enrich';
    try {
      const options = await enrichUserInput(input);
      const generation: ChoiceGeneration = {
        id: uuidv4(),
        timestamp: Date.now(),
        count: options.length,
        options: options.map(text => ({ text, sourceEntryId: null })),
      };
      storeEnrichGeneration(messageId.value, swipeId.value, generation);
      // 重新加载以同步 store 状态
      const data = getMessageChoiceData(messageId.value, swipeId.value);
      if (data) {
        enrichGenerations.value = data.enrichGenerations ?? [];
        enrichCurrentIndex.value = data.enrichCurrentIndex ?? 0;
      }
    } catch (e) {
      activeView.value = 'options';
      if ((e as Error)?.name !== 'AbortError') {
        console.error('[Choice] 润色失败', e);
        toastr.error(`润色失败: ${e instanceof Error ? e.message : '未知错误'}`);
      }
    } finally {
      enrichLoading.value = false;
    }
  }

  /** 手动切换（面板头部/箭头点击）：锁定期间仍可用，且把锁定状态更新为新状态——
   *  锁的是「自动化」而非「面板」，用户把面板手动停在哪个状态，锁定就跟随钉在哪个状态 */
  function setCollapsed(v: boolean) {
    collapsed.value = v;
    if (locked.value) {
      gs.settings.ui.panel_lock = v ? 'collapsed' : 'open';
    }
  }

  /** 自动化点位专用（生成完成展开/点选项收起/发消息收起等）：锁定时直接拒绝。
   *  自动化不得改走 setCollapsed——那会回写 panel_lock，把用户钉好的锁定语义悄悄改掉 */
  function autoSetCollapsed(v: boolean) {
    if (locked.value) {
      return;
    }
    collapsed.value = v;
  }

  return {
    messageId,
    swipeId,
    generations,
    currentIndex,
    currentGeneration,
    visibleOptions,
    hasHistory,
    load,
    clear,
    goTo,
    activeView,
    enrichGenerations,
    enrichCurrentIndex,
    currentEnrichGeneration,
    hasEnrichHistory,
    enrichLoading,
    collapsed,
    setCollapsed,
    locked,
    autoSetCollapsed,
    triggerEnrichRequested,
    setActiveView,
    enrichGoTo,
    triggerEnrich,
  };
});
