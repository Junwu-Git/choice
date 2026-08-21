import '@/global.css';
import { initPanelMount } from '@/core/panel-mount';
import { initPanel } from '@/panel';
import { pinia } from '@/pinia';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { eventSource, event_types } from '@sillytavern/scripts/events';

$(() => {
  try {
    setActivePinia(pinia);

    useCharacterSettingsStore();
    useChatSettingsStore();

    eventSource.on(event_types.CHAT_CHANGED, () => {
      try {
        useCharacterSettingsStore().reload();
        useChatSettingsStore().reload();
      } catch (error) {
        console.error('[Choice] store reload on CHAT_CHANGED failed', error);
      }
    });
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
      try {
        useCharacterSettingsStore().reload();
      } catch (error) {
        console.error('[Choice] store reload on CHARACTER_PAGE_LOADED failed', error);
      }
    });

    initPanel();
    initPanelMount();
  } catch (error) {
    console.error('[Choice] init failed', error);
    toastr.error(`Choice 初始化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});
