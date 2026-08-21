import { chat_metadata } from '@sillytavern/script';
import { saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import { ChatSettings, setting_field } from '@/type/settings';
import { validateInplace } from '@/util/zod';

export const useChatSettingsStore = defineStore('chat-settings', () => {
  let reloading = false;
  const settings = ref(validateInplace(ChatSettings, chat_metadata[setting_field]));

  const reload = () => {
    reloading = true;
    settings.value = validateInplace(ChatSettings, chat_metadata[setting_field]);
    nextTick(() => {
      reloading = false;
    });
  };

  watch(
    settings,
    new_settings => {
      if (reloading) {
        return;
      }
      chat_metadata[setting_field] = klona(new_settings);
      saveMetadataDebounced();
    },
    { deep: true },
  );

  return {
    settings,
    reload,
  };
});
