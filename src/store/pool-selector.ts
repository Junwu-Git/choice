import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { PoolConfig, PoolEntry } from '@/type/settings';

export const usePoolSelectorStore = defineStore('pool-selector', () => {
  const globalStore = useGlobalSettingsStore();

  const characterStore = useCharacterSettingsStore();
  const chatStore = useChatSettingsStore();

  const effectiveConfig = computed<PoolConfig | null>(() => {
    const chatConfigId = chatStore.settings.config_id;
    if (chatConfigId) {
      return globalStore.settings.configs.find(c => c.id === chatConfigId) ?? null;
    }
    const charConfigId = characterStore.settings.config_id;
    if (charConfigId) {
      return globalStore.settings.configs.find(c => c.id === charConfigId) ?? null;
    }
    return globalStore.settings.configs.find(c => c.is_default) ?? null;
  });

  const effectivePool = computed<PoolEntry[]>(() => {
    const config = effectiveConfig.value;
    if (!config) {
      return [...globalStore.settings.master_pool];
    }
    const entryMap = new Map(config.entries.map(e => [e.entry_id, e]));
    return globalStore.settings.master_pool
      .filter(e => {
        // 只保留 config 引用的条目；enabled === false 为配置层停用，解析层直接剔除
        const cfg = entryMap.get(e.id);
        return cfg !== undefined && cfg.enabled !== false;
      })
      .map(e => {
        const cfg = entryMap.get(e.id)!;
        // content/type/rule/category 只读 master_pool（内容层唯一真相源）；
        // pinned/weight 是配置层覆盖项。v20 起 condition 已随 schema 删除
        return { ...e, pinned: cfg.pinned, weight: cfg.weight };
      });
  });

  return {
    effectiveConfig,
    effectivePool,
  };
});
