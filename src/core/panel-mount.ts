import toastr from 'toastr';
import ActionOptionsPanel from '@/components/ActionOptionsPanel.vue';
import { chat } from '@sillytavern/script';
import { generateOptions, generatorState } from '@/core/generator';
import { getMessageSwipeId, storeGeneration } from '@/core/options-store';
import { cancelEnrich } from '@/core/enrich-input';
import { pinia } from '@/pinia';
import { useGlobalSettingsStore } from '@/store/global-settings';
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
        // chat[] 元素是 ST 原生楼层结构（is_user/is_system/mes 等字段在 StChatMessage 上），
        // @sillytavern/script 导出的 chat 类型是 TavernHelper 子集，需显式断言
        const message = chat[i] as StChatMessage | undefined;
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
      // 停靠模式（输入框上方）：面板固定插在 #send_form 之前，不随聊天滚动。
      // 幂等检查必须做——resync 在聊天事件里高频触发，无脑 insertBefore 会反复搬移
      // DOM 节点，丢掉面板内滚动位置且徒增布局开销。
      // 判据是 next 而非 prev：#form_sheld 里 send_form 之前还有 ST 的删除确认条
      // dialogue_del_mes，插完后 mount.prev() 是它而非 send_form。
      // store 在此处按需取（外层 gs 常量声明在本函数首次调用之后，闭包直接引用会踩 TDZ）
      if (useGlobalSettingsStore(pinia).settings.ui.panel_position === 'input') {
        if (!$container.next().is('#send_form')) {
          $container.insertBefore('#send_form');
        }
        return;
      }
      const $last = $('#chat .mes.last_mes');
      if ($last.length) {
        if (!$container.prev().is($last)) {
          $container.insertAfter($last);
        }
      } else if (!$container.parent().is('#chat')) {
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
      if (!(chat[messageId] as StChatMessage | undefined)?.mes?.trim()) {
        return;
      }
      if (type === 'quiet') {
        return;
      }
      if (messageId === 0) {
        return;
      }
      const gs = useGlobalSettingsStore(pinia);
      if (!gs.settings.auto_generate) {
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
      // 自动生成完成后的展开走 autoSetCollapsed：锁定时保持用户钉住的状态
      panelStore.autoSetCollapsed(false);
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
  eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
    safeResync();
    // 发消息后自动收起走 autoSetCollapsed：锁定时常开面板不被动收起
    panelStore.autoSetCollapsed(true);
  });
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

  // 输入润色按钮：注入到输入框右侧，单按钮切换空闲/取消状态
  const $enrichBtn = $(
    '<div id="choice_enrich_btn" class="fa-solid fa-pen-to-square interactable" title="润色输入" style="display:none; margin-right:6px; font-size:16px; cursor:pointer; opacity:0.7"></div>',
  );

  const gs = useGlobalSettingsStore(pinia);

  const tryInjectEnrichBtn = () => {
    if ($('#choice_enrich_btn').length) return;
    const $target = $('#rightSendForm');
    if ($target.length) {
      $enrichBtn.insertBefore('#send_but');
      // 只有输入框有内容且开关开启时显示按钮
      $('#send_textarea').on('input', () => {
        const val = ($('#send_textarea').val() as string).trim();
        $enrichBtn.toggle(gs.settings.ui.enrich_enabled && val.length > 0);
      });
    }
  };

  tryInjectEnrichBtn();
  setTimeout(tryInjectEnrichBtn, 1000);
  setTimeout(tryInjectEnrichBtn, 3000);

  // 监听 enrich_enabled 开关变化，同步更新按钮显隐
  const updateEnrichBtn = () => {
    const val = ($('#send_textarea').val() as string).trim();
    $enrichBtn.toggle(gs.settings.ui.enrich_enabled && val.length > 0);
  };
  // 设置任何字段变化都触发：enrich 按钮显隐同步 + 面板停靠位置即时迁移
  // （reposition 自带幂等检查，非位置字段的变更不会造成 DOM 搬移）
  gs.$subscribe(() => {
    updateEnrichBtn();
    reposition();
  });

  $enrichBtn.on('click', async () => {
    if (!gs.settings.ui.enrich_enabled) return;
    const store = usePanelStateStore(pinia);

    // 正在润色中 → 取消
    if (store.enrichLoading) {
      cancelEnrich();
      store.enrichLoading = false;
      store.setActiveView('options');
      $enrichBtn.removeClass('fa-stop').addClass('fa-pen-to-square').attr('title', '润色输入');
      return;
    }

    const input = ($('#send_textarea').val() as string).trim();
    if (!input) return;

    $enrichBtn.removeClass('fa-pen-to-square').addClass('fa-stop').attr('title', '取消润色');
    try {
      await store.triggerEnrich(input);
    } finally {
      $enrichBtn.removeClass('fa-stop').addClass('fa-pen-to-square').attr('title', '润色输入');
    }
  });

  // 面板「生成润色」按钮点击时，通过 store 标志位触发润色流程
  const enrichStore = usePanelStateStore(pinia);
  enrichStore.$subscribe((_mutation: any, state: any) => {
    if (!state.triggerEnrichRequested) return;
    const input = ($('#send_textarea').val() as string).trim();
    if (!input) {
      toastr.warning(t`输入框为空，无法润色`);
      state.triggerEnrichRequested = false;
      return;
    }
    state.triggerEnrichRequested = false;
    enrichStore.triggerEnrich(input);
  });
}
