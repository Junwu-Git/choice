import { defineStore } from 'pinia';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import type { PromptConfig } from '@/type/settings';

export const usePromptConfigSelectorStore = defineStore('prompt-config-selector', () => {
  const globalStore = useGlobalSettingsStore();
  const characterStore = useCharacterSettingsStore();
  const chatStore = useChatSettingsStore();

  const effectiveConfig = computed<PromptConfig | null>(() => {
    const chatConfigId = chatStore.settings.prompt_config_id;
    if (chatConfigId) {
      return globalStore.settings.prompt_configs.find(c => c.id === chatConfigId) ?? null;
    }
    const charConfigId = characterStore.settings.prompt_config_id;
    if (charConfigId) {
      return globalStore.settings.prompt_configs.find(c => c.id === charConfigId) ?? null;
    }
    return globalStore.settings.prompt_configs.find(c => c.is_default) ?? null;
  });

  return { effectiveConfig };
});
