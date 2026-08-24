import { getMessageChoiceData, setMessageChoiceData } from '@/core/options-store';
import type { ChoiceGeneration, ChoiceOption } from '@/core/options-store';

export const usePanelStateStore = defineStore('panel-state', () => {
  const messageId = ref<number | null>(null);
  const swipeId = ref(0);
  const generations = ref<ChoiceGeneration[]>([]);
  const currentIndex = ref(0);

  /** 润色模式：用户输入润色选项 */
  const enrichMode = ref(false);
  const enrichOptions = ref<ChoiceOption[]>([]);
  const enrichLoading = ref(false);

  const currentGeneration = computed<ChoiceGeneration | null>(() => generations.value[currentIndex.value] ?? null);
  const visibleOptions = computed(() => {
    if (enrichMode.value) return enrichOptions.value;
    return currentGeneration.value?.options ?? [];
  });
  const hasHistory = computed(() => generations.value.length > 0);

  const load = (message_id: number, swipe_id: number) => {
    const data = getMessageChoiceData(message_id, swipe_id);
    messageId.value = message_id;
    swipeId.value = swipe_id;
    generations.value = data?.generations ?? [];
    currentIndex.value = data?.currentIndex ?? Math.max(0, (data?.generations.length ?? 1) - 1);
  };

  const clear = () => {
    messageId.value = null;
    swipeId.value = 0;
    generations.value = [];
    currentIndex.value = 0;
  };

  const goTo = (index: number) => {
    if (index < 0 || index >= generations.value.length) {
      return;
    }
    currentIndex.value = index;
    setMessageChoiceData(messageId.value as number, swipeId.value, {
      generations: generations.value,
      currentIndex: index,
    });
  };

  function enterEnrichMode(options: ChoiceOption[]) {
    enrichOptions.value = options;
    enrichMode.value = true;
    enrichLoading.value = false;
  }

  function exitEnrichMode() {
    enrichMode.value = false;
    enrichOptions.value = [];
    enrichLoading.value = false;
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
    enrichMode,
    enrichOptions,
    enrichLoading,
    enterEnrichMode,
    exitEnrichMode,
  };
});
