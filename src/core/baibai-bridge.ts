interface BaiBaiBookApi {
  apiVersion: number;
  pluginVersion: string;
  capabilities: Record<string, boolean>;
  getSnapshot(options?: { floor?: number; at?: 'before' | 'after' }): BaiBaiSnapshot | null;
  getHistory(options: { before: number }): BaiBaiHistory | null;
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

/** 获取柏宝书摘要文本：楼层 [0, windowStart) 的压缩摘要。windowStart = 本扩展聊天历史
 *  窗口首楼的原始下标（正文层起点）；-1 = 本扩展不发任何正文 → before 取全部楼层，
 *  摘要顶替整段历史。对齐柏宝书自身注入模型「摘要[0,keepStart) + 正文[keepStart,end)
 *  顺序相接零重复」：before 是排他截止楼层，getHistory 跨边界自动拆节点、不受柏宝书
 *  自身滑动窗口限制。旧实现 getInjectedHistory()（柏宝书自己的隐藏楼层集合）与全量
 *  降级的边界都跟本扩展正文窗口无关——全量降级会把最近楼层「摘要+全文」各发一遍。 */
export function getBaiBaiSummary(windowStart: number): string | null {
  const api = getApi();
  if (!api) return null;
  try {
    const chat = window.SillyTavern?.getContext?.()?.chat;
    const len = chat?.length ?? 0;
    if (len <= 0) return null;
    const hist = api.getHistory({ before: windowStart < 0 ? len : windowStart });
    return hist?.relativeText || null;
  } catch (e) {
    // getHistory 对越界 before 抛 RangeError——windowStart 源自 chat 下标本不该越界，兜一层
    console.warn('[Choice][BaiBaiBook] 获取摘要失败:', e);
  }
  return null;
}
