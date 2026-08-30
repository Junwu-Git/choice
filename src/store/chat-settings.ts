import { chat_metadata } from '@sillytavern/script';
import { saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import { ChatSettings, setting_field, type WorldInfoChatSettings } from '@/type/settings';
import { validateInplace } from '@/util/zod';

/** 世界书聊天级设置迁移（幂等）：
 *  1. excluded_books（聊天级排除书）→ book_entry_modes[name]='off'（三态 off 档吸收），清空；
 *  2. excluded_entries（显式条目排除，`书名::uid`）→ book_entry_overrides[书][uid]=false，清空。
 *  ChatSettings 无 schema_version 字段（走不了全局设置的版本迁移块），故在每次校验后执行；
 *  两数组迁移后为空即天然不再触发。 */
function migrateWorldInfo(wi: WorldInfoChatSettings) {
  if (wi.excluded_books.length > 0) {
    for (const name of wi.excluded_books) {
      wi.book_entry_modes[name] = 'off';
    }
    wi.excluded_books = [];
  }
  if (wi.excluded_entries.length > 0) {
    for (const key of wi.excluded_entries) {
      const sep = key.indexOf('::');
      if (sep === -1) continue;
      const book = key.slice(0, sep);
      const uid = key.slice(sep + 2);
      const overrides = wi.book_entry_overrides[book] ?? {};
      overrides[uid] = false;
      wi.book_entry_overrides[book] = overrides;
    }
    wi.excluded_entries = [];
  }
}

export const useChatSettingsStore = defineStore('chat-settings', () => {
  let reloading = false;
  if (!chat_metadata[setting_field]) {
    chat_metadata[setting_field] = {};
  }
  const settings = ref(initSettings());

  function initSettings() {
    const parsed = validateInplace(ChatSettings, chat_metadata[setting_field]);
    migrateWorldInfo(parsed.world_info);
    return parsed;
  }

  const reload = () => {
    reloading = true;
    if (!chat_metadata[setting_field]) {
      chat_metadata[setting_field] = {};
    }
    settings.value = initSettings();
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
