import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { PoolEntry } from '@/type/settings';

export type PoolLayer = 'global' | 'character' | 'chat';

export const usePoolSelectorStore = defineStore('pool-selector', () => {
  const globalStore = useGlobalSettingsStore();
  const characterStore = useCharacterSettingsStore();
  const chatStore = useChatSettingsStore();

  const effectiveLayer = computed<PoolLayer>(() => {
    if (chatStore.settings.pool.length > 0) {
      return 'chat';
    }
    if (characterStore.settings.pool.length > 0) {
      return 'character';
    }
    return 'global';
  });

  const effectivePool = computed<PoolEntry[]>(() => {
    switch (effectiveLayer.value) {
      case 'chat':
        return chatStore.settings.pool;
      case 'character':
        return characterStore.settings.pool;
      default:
        return globalStore.settings.pool;
    }
  });

  const layerActive = (layer: PoolLayer) => layer === effectiveLayer.value;

  return {
    effectiveLayer,
    effectivePool,
    layerActive,
  };
});
