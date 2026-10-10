import toastr from 'toastr';
import '@/theme.css';
import '@/global.css';
import { initPanelMount } from '@/core/panel-mount';
import { initWandMenu } from '@/core/wand-menu';
import {
  syncDiceContractPrompt,
  clearDiceTurnPrompt,
  clearPendingTurn,
  flushPendingTurnMarker,
} from '@/core/dice-contract';
import { pinia } from '@/pinia';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { eventSource, event_types } from '@sillytavern/scripts/events';
import FloatingRoot from '@/components/FloatingRoot.vue';

function initFloatingApp() {
  const $root = $('<div id="choice-floating-root">').appendTo(document.body);
  const app = createApp(FloatingRoot);
  app.use(pinia);
  app.config.globalProperties.t = t;
  app.mount($root[0]);
}

$(() => {
  setActivePinia(pinia);

  // 逐项隔离初始化：单个 store/入口失败（如一张坏角色卡炸掉 Zod parse）不应连带
  // 整扩展 UI 全灭——悬浮球/魔棒/面板各自独立挂载，缺谁补谁
  const step = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      console.error(`[Choice] init ${name} failed`, error);
      toastr.error(`Choice ${name}初始化失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  step('设置 store', () => {
    useCharacterSettingsStore();
    useChatSettingsStore();
  });

  // 判定契约（v67）：正文 AI 常驻说明「消息开头的 HTML 注释是骰子裁定指令」。
  // 立即同步一次 + watch 开关；常驻契约槽不随聊天切换变化，无需挂 CHAT_CHANGED
  // （每回合动态槽不同：全局注入态，CHAT_CHANGED 时随挂起判定一并清，见下方订阅）。
  // 每回合动态槽（choice_dice_turn，见 dice-contract.ts）：send 点选判定时由 option-action
  // 挂载，此处只负责「消费即清」——AI 回复落地/中止后裁定已消费或失效。事件名已核对
  // 酒馆源码（script.js:3477/5559 emit，panel-mount 已有 MESSAGE_RECEIVED/GENERATION_ENDED 先例）。
  // 挂起判定回写：玩家消息入 chat（MESSAGE_SENT）时把判定注释前插进该消息——时序早于
  // Generate 的提示词构建（script.js:4394 sendMessageAsUser 先行、5858 emit 后才组装），
  // 回写必然被本次请求读到。
  step('判定契约', () => {
    const gs = useGlobalSettingsStore();
    clearDiceTurnPrompt(); // init 兜底：清掉会话内可能残留的上一回合裁定
    clearPendingTurn();
    syncDiceContractPrompt();
    watch(
      () => [gs.settings.dice.enabled, gs.settings.dice.main_ai_awareness] as const,
      ([enabled, awareness]) => {
        syncDiceContractPrompt();
        // 开关关闭时同步撤下动态槽与挂起判定，防已挂载的裁定残留
        if (!enabled || !awareness) {
          clearDiceTurnPrompt();
          clearPendingTurn();
        }
      },
    );
    eventSource.on(event_types.GENERATION_ENDED, clearDiceTurnPrompt);
    eventSource.on(event_types.GENERATION_STOPPED, clearDiceTurnPrompt);
    eventSource.on(event_types.MESSAGE_RECEIVED, clearDiceTurnPrompt);
    eventSource.on(event_types.MESSAGE_SENT, (chatId: number) => flushPendingTurnMarker(chatId));
  });

  try {
    eventSource.on(event_types.CHAT_CHANGED, () => {
      try {
        useCharacterSettingsStore().reload();
        useChatSettingsStore().reload();
        // 换聊天清空挂起判定：判定归属旧聊天的回合，跨聊天误挂会污染新聊天首楼
        clearPendingTurn();
        // 每回合动态槽同样随聊天清：IN_CHAT 注入槽是全局态，生成中切聊天时旧回合的
        // 「已裁定」摘要会残留进新聊天首次生成请求；「不随聊天变化」只对常驻契约槽成立
        clearDiceTurnPrompt();
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
  } catch (error) {
    console.error('[Choice] event subscription failed', error);
  }

  step('悬浮球', initFloatingApp);
  step('魔棒菜单', initWandMenu);
  step('主面板', initPanelMount);
});
