import ActionOptionsPanel from '@/components/ActionOptionsPanel.vue';
import { chat } from '@sillytavern/script';
import { generateOptions, generatorState } from '@/core/generator';
import { getMessageSwipeId, storeGeneration } from '@/core/options-store';
import { pinia } from '@/pinia';
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePanelStateStore } from '@/store/panel-state';
import { eventSource, event_types } from '@sillytavern/scripts/events';

export function initPanelMount() {
  const $container = $('<div id="choice-panel-mount"></div>').appendTo('#chat');

  const app = createApp(ActionOptionsPanel);
  app.use(pinia);
  app.config.globalProperties.t = t;
  app.mount($container[0]);

  const panelStore = usePanelStateStore(pinia);

  const getPanelMessageId = (): number | null => {
    try {
      for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (message && !message.is_user && !message.is_system) {
          return i;
        }
      }
    } catch (error) {
      console.error('[Choice] getPanelMessageId failed', error);
    }
    return null;
  };

  const reposition = () => {
    try {
      const $last = $('#chat .mes.last_mes');
      if ($last.length) {
        $container.insertAfter($last);
      } else {
        $container.appendTo('#chat');
      }
    } catch (error) {
      console.error('[Choice] reposition failed', error);
    }
  };

  const resync = () => {
    try {
      reposition();
      const messageId = getPanelMessageId();
      if (messageId === null) {
        panelStore.clear();
        return;
      }
      panelStore.load(messageId, getMessageSwipeId(messageId));
    } catch (error) {
      console.error('[Choice] resync failed', error);
    }
  };

  const onMessageReceived = async (messageId: number, type: string) => {
    try {
      resync();
      if (type === 'quiet') {
        return;
      }
      const chatStore = useChatSettingsStore(pinia);
      if (!chatStore.settings.auto_generate) {
        return;
      }
      if (generatorState.loading) {
        return;
      }
      const swipeId = getMessageSwipeId(messageId);
      const generation = await generateOptions({ messageId, swipeId });
      if (!generation) {
        return;
      }
      storeGeneration(messageId, swipeId, generation);
      resync();
    } catch (error) {
      console.error('[Choice] onMessageReceived failed', error);
    }
  };

  const safeResync = () => {
    try {
      resync();
    } catch (error) {
      console.error('[Choice] safeResync failed', error);
    }
  };

  eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
  eventSource.on(event_types.MESSAGE_SWIPED, safeResync);
  eventSource.on(event_types.MESSAGE_DELETED, safeResync);
  eventSource.on(event_types.MESSAGE_UPDATED, safeResync);
  eventSource.on(event_types.USER_MESSAGE_RENDERED, safeResync);
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, safeResync);
  eventSource.on(event_types.CHAT_CHANGED, safeResync);
  eventSource.on(event_types.MORE_MESSAGES_LOADED, safeResync);
  eventSource.on(event_types.APP_READY, safeResync);
  eventSource.on(event_types.GENERATION_ENDED, safeResync);

  resync();
  let pollCount = 0;
  const pollInterval = setInterval(() => {
    safeResync();
    pollCount++;
    if (pollCount >= 15) {
      clearInterval(pollInterval);
    }
  }, 2000);
}
