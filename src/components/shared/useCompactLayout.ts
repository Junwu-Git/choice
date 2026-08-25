import { computed, type Ref } from 'vue';

const COMPACT_BREAKPOINT = 420;

export function useCompactLayout(target: Ref<HTMLElement | null>) {
  const { width } = useElementSize(target);
  const isCompact = computed(() => width.value > 0 && width.value < COMPACT_BREAKPOINT);
  return { isCompact };
}