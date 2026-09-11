interface BaiBaiBookApi {
  apiVersion: number;
  pluginVersion: string;
  capabilities: Record<string, boolean>;
  getSnapshot(options?: { floor?: number; at?: 'before' | 'after' }): BaiBaiSnapshot | null;
  getHistory(options: { before: number }): BaiBaiHistory | null;
  getInjectedHistory(): BaiBaiHistory | null;
  getContextAtFloor(options: { floor: number }): BaiBaiContext | null;
}

interface BaiBaiSnapshot {
  apiVersion: number;
  pluginVersion: string;
  revision: number;
  chat: { id: string; characterName: string; groupId: string | null; length: number };
  point: { floor: number; at: string; upToExclusive: number };
  coverage: { complete: boolean; missingAiFloors: number[] };
  state: { time: string; location: string; locationPath: string[] };
  protagonist: { gender: string; identity: string; appearance: string; outfit: string; condition: string };
  vars: Record<string, any>;
  items: any[];
  plans: any[];
  scenes: any[];
  npcs: any[];
  itemLog: any[];
}

interface BaiBaiHistory {
  text: string;
  relativeText: string;
  nodes: any[];
  coverage: { complete: boolean; missingAiFloors: number[] };
}

interface BaiBaiContext {
  floorData: any;
  floorSummary: string | null;
  floorDelta: string | null;
  snapshotBefore: BaiBaiSnapshot | null;
  snapshotAfter: BaiBaiSnapshot | null;
  historyBefore: BaiBaiHistory | null;
  coverage: { complete: boolean; missingAiFloors: number[] };
}

function getApi(): BaiBaiBookApi | null {
  return (globalThis as any).STBaiBaiBook ?? null;
}

/** 获取柏宝书摘要/历史剧情文本（使用注入口径，与正常记忆注入同规则）。
 *  优先 getInjectedHistory()（跳过滑动窗口内仍发全文的摘要），
 *  降级为 getHistory()（从最开始到最新楼的全部历史）。 */
export function getBaiBaiSummary(): string | null {
  const api = getApi();
  if (!api) return null;
  try {
    const injected = api.getInjectedHistory();
    if (injected?.relativeText) return injected.relativeText;
    // 降级：取全部历史（截止到最新楼）
    const chat = window.SillyTavern?.getContext?.()?.chat;
    const len = chat?.length ?? 0;
    if (len > 0) {
      const hist = api.getHistory({ before: len });
      if (hist?.relativeText) return hist.relativeText;
    }
  } catch (e) {
    console.warn('[Choice][BaiBaiBook] 获取摘要失败:', e);
  }
  return null;
}
