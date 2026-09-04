import toastr from 'toastr';
import ActionOptionsPanel from '@/components/ActionOptionsPanel.vue';
import UserStatusBar from '@/components/UserStatusBar.vue';
import { chat } from '@sillytavern/script';
import { generateOptions, generatorState, resolveCustomApi } from '@/core/generator';
import { getMessageSwipeId, storeGeneration } from '@/core/options-store';
import { cancelEnrich } from '@/core/enrich-input';
import {
  updateUserStatus,
  refreshStatusInjection,
} from '@/core/status-tracker';
import { useChatSettingsStore } from '@/store/chat-settings';
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

  // 状态栏：楼层内嵌组件，独立 mount 节点（与选项面板分离，互不干扰）
  const $statusContainer = $('<div id="choice-status-bar-mount"></div>').appendTo('#chat');
  const statusApp = createApp(UserStatusBar);
  statusApp.use(pinia);
  statusApp.config.globalProperties.t = t;
  statusApp.mount($statusContainer[0]);

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
      // 状态栏始终楼层内嵌（插在 last_mes 之后），不受选项面板停靠模式影响
      const $last = $('#chat .mes.last_mes');
      if ($last.length) {
        if (!$statusContainer.prev().is($last)) {
          $statusContainer.insertAfter($last);
        }
      } else if (!$statusContainer.parent().is('#chat')) {
        $statusContainer.appendTo('#chat');
      }

      // 选项面板停靠模式（输入框上方）：面板固定插在 #send_form 之前，不随聊天滚动。
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
      // 聊天模式：选项面板插在状态栏之后（楼层 → 状态栏 → 选项面板）
      if ($last.length) {
        if (!$container.prev().is($statusContainer)) {
          $container.insertAfter($statusContainer);
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

  // 不能把 generateOptions 的 await 留在监听器里：ST 的 eventSource.emit 串行 await
  // 每个监听器（public/lib/eventemitter.js），而 MESSAGE_RECEIVED 之后紧接着才 emit
  // CHARACTER_MESSAGE_RENDERED——酒馆助手前端卡渲染正挂在该事件上
  // （JS-Slash-Runner src/store/iframe_runtimes/message.ts）。监听器不返回就会把
  // 整次二次 API 调用的耗时推迟到正文卡片渲染之前。故通过检查后脱钩 fire-and-forget：
  //   - storeGeneration 内部自带 saveChatDebounced（options-store.ts），落盘不依赖
  //     ST 主保存时序；
  //   - generateOptions 在首个 await 前同步置位 generatorState.loading（generator.ts），
  //     与下方 loading 守卫之间无竞态窗口。
  const onMessageReceived = (messageId: number, type: string) => {
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
      const cs = useChatSettingsStore(pinia);
      const stConfig = cs.settings.status_tracking;

      // 被动状态自动更新：独立于选项 auto_generate，各自开关互不阻塞。
      // 与选项生成并行 fire-and-forget（两者各自 loading 守卫互斥，API 调用独立）。
      // 前置 API 检查同选项生成——不弹窗抢焦点，只 toastr 警告跳过
      if (stConfig.enabled && stConfig.auto_update) {
        if (resolveCustomApi(gs.settings.active_api_id, gs.settings.apis)) {
          const swipeId = getMessageSwipeId(messageId);
          void (async () => {
            await updateUserStatus(messageId, swipeId);
          })().catch(error => console.error('[Choice] status auto-update failed', error));
        } else {
          toastr.warning(t`未配置 API，跳过状态更新`);
        }
      }

      if (!gs.settings.auto_generate) {
        return;
      }
      if (generatorState.loading) {
        return;
      }
      // 自动生成场景的前置 API 检查：这里不能弹向导/设置面板——AI 刚回复完就抢焦点
      // 体验极差，只轻提示后跳过；主动召回（弹设置+聚焦 API 步）在用户手动点
      // 「生成」时由 ActionOptionsPanel.onToggle 触发
      if (!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis)) {
        toastr.warning(t`未配置 API，跳过自动生成选项`);
        return;
      }
      const swipeId = getMessageSwipeId(messageId);
      void (async () => {
        const generation = await generateOptions({ messageId, swipeId });
        if (!generation) {
          return;
        }
        storeGeneration(messageId, swipeId, generation);
        // 自动生成完成后的展开走 autoSetCollapsed：锁定时保持用户钉住的状态
        panelStore.autoSetCollapsed(false);
        resync();
      })().catch(error => console.error('[Choice] onMessageReceived failed', error));
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
  // 正文生成开始前刷新状态注入：确保 extension_prompts 拿到最新被动状态快照。
  // setExtensionPrompt 写入全局 extension_prompts 对象，ST 在 buildFinalPrompt 时读取——
  // GENERATION_STARTED 早于 prompt 组装，时序上保证注入生效
  eventSource.on(event_types.GENERATION_STARTED, () => {
    try {
      refreshStatusInjection();
    } catch (error) {
      console.warn('[Choice] refreshStatusInjection on GENERATION_STARTED failed', error);
    }
  });

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
