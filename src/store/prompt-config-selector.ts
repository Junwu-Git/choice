import { useGlobalSettingsStore } from '@/store/global-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import type { PromptConfig } from '@/type/settings';

export const usePromptConfigSelectorStore = defineStore('prompt-config-selector', () => {
  const globalStore = useGlobalSettingsStore();
  const characterStore = useCharacterSettingsStore();
  const chatStore = useChatSettingsStore();

  const effectiveConfig = computed<PromptConfig | null>(() => {
    // 覆盖式 chat > character > default；绑定 id 悬空（配置已在别处被删）时逐级降级而非落空
    // ——与 pool-selector 同构（同一覆盖语义两套 selector，口径勿漂移）。悬空落空会让
    // PromptEditor 的生效徽标显示 '—'、选中态跳到 configs[0]，与实际生成侧的回退不一致。
    const chatConfigId = chatStore.settings.prompt_config_id;
    if (chatConfigId) {
      const hit = globalStore.settings.prompt_configs.find(c => c.id === chatConfigId);
      if (hit) return hit;
    }
    const charConfigId = characterStore.settings.prompt_config_id;
    if (charConfigId) {
      const hit = globalStore.settings.prompt_configs.find(c => c.id === charConfigId);
      if (hit) return hit;
    }
    return globalStore.settings.prompt_configs.find(c => c.is_default) ?? null;
  });

  return { effectiveConfig };
});
