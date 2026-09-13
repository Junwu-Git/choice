import { chat, saveChatDebounced } from '@sillytavern/script';
import { setting_field } from '@/type/settings';

export type ChoiceOption = {
  text: string;
  sourceEntryId: string | null;
};

export type ChoiceGeneration = {
  id: string;
  timestamp: number;
  count: number;
  options: ChoiceOption[];
  /** 本轮实际抽取使用的池条目 id 集合：随消息持久化，供条目级统计与建议归因
   * （选项是 AI 自由生成文本，无法逐项归因到单条，只能记轮次级集合）。 */
  poolEntryIds: string[];
  /** 生成时生效的统计维度（config.id；无 config 会话为 '__none__'）。
   *  信息性字段：统计命中回写基于窗口 recent 的 gid 全局搜索定位，不依赖本字段；
   *  老消息/润色结果可能缺省，读取处用 ?? 兜底。 */
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
