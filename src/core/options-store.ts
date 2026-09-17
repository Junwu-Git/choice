import { chat, saveChatDebounced } from '@sillytavern/script';
import { setting_field } from '@/type/settings';

export type ChoiceOption = {
  text: string;
  sourceEntryId: string | null;
  /** 生成时文本匹配到的候选条目 id（精确归因，见 option-attribution.ts）；AI 自由发挥
   *  为 null，旧代无本字段（undefined）。统计「命中」只记匹配条目；无字段的旧代点击
   *  回退整轮共现归因（见 stats.ts recordOptionSelected）。 */
  matchedEntryId?: string | null;
};

export type ChoiceGeneration = {
  id: string;
  timestamp: number;
  count: number;
  options: ChoiceOption[];
  /** 本轮实际进入候选菜单的池条目 id 集合（固定必发 pinned 与抽签候选均计入）：
   *  随消息持久化，供条目级统计与参与/期望归因；精确逐项归因见 options[].matchedEntryId */
  poolEntryIds: string[];
  /** 生成时生效的统计维度（config.id；无 config 会话为 '__none__'）。
   *  命中回写优先直用本字段（避免点击时切 config 记错维度）；旧消息缺省时统计层
   *  回退窗口 recent 的 gid 全局搜索定位（findHitScope）。 */
  scopeId?: string;
};

type MessageChoiceData = {
  generations: ChoiceGeneration[];
  currentIndex: number;
  enrichGenerations: ChoiceGeneration[];
  enrichCurrentIndex: number;
};

const getMessage = (messageId: number): StChatMessage | undefined => chat[messageId] as StChatMessage | undefined;

export function getMessageSwipeId(messageId: number): number {
  return getMessage(messageId)?.swipe_id ?? 0;
}

export function getMessageChoiceData(messageId: number, swipeId: number): MessageChoiceData | null {
  const message = getMessage(messageId);
  if (!message) {
    return null;
  }
  const data = message.extra?.[setting_field]?.[String(swipeId)];
  return data ? (klona(data) as MessageChoiceData) : null;
}

export function setMessageChoiceData(messageId: number, swipeId: number, data: MessageChoiceData) {
  const message = getMessage(messageId);
  if (!message) {
    return;
  }
  message.extra = message.extra || {};
  message.extra[setting_field] = message.extra[setting_field] || {};
  message.extra[setting_field][String(swipeId)] = klona(data);
  saveChatDebounced();
}

export function storeGeneration(messageId: number, swipeId: number, generation: ChoiceGeneration) {
  const data = getMessageChoiceData(messageId, swipeId) ?? {
    generations: [],
    currentIndex: 0,
    enrichGenerations: [],
    enrichCurrentIndex: 0,
  };
  data.generations.push(generation);
  data.currentIndex = data.generations.length - 1;
  setMessageChoiceData(messageId, swipeId, data);
}

export function storeEnrichGeneration(messageId: number, swipeId: number, generation: ChoiceGeneration) {
  const data = getMessageChoiceData(messageId, swipeId) ?? {
    generations: [],
    currentIndex: 0,
    enrichGenerations: [],
    enrichCurrentIndex: 0,
  };
  data.enrichGenerations = data.enrichGenerations ?? [];
  data.enrichGenerations.push(generation);
  data.enrichCurrentIndex = data.enrichGenerations.length - 1;
  setMessageChoiceData(messageId, swipeId, data);
}
