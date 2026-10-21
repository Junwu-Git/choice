/**
 * 记忆摘要桥接：从外部记忆系统读取「已离开上下文窗口的旧剧情」压缩摘要。
 *
 * 只读、可选、fail-safe：外部系统未安装或接口不可用时返回 null，主体功能零影响。
 * 运行时契约（全局对象名与字段名）由对方定义，不能改；本模块其余部分不引用对方实现。
 */

interface ExternalMemoryApi {
  apiVersion: number;
  pluginVersion: string;
  capabilities: Record<string, boolean>;
  getSnapshot(options?: { floor?: number; at?: 'before' | 'after' }): unknown;
  getHistory(options: { before: number }): { text: string; relativeText: string } | null;
  getContextAtFloor(options: { floor: number }): unknown;
}

function getApi(): ExternalMemoryApi | null {
  return (globalThis as any).STBaiBaiBook ?? null;
}

/** 获取摘要文本：楼层 [0, windowStart) 的压缩摘要。windowStart = 本扩展聊天历史
 *  窗口首楼的原始下标（正文层起点）；-1 = 本扩展不发任何正文 → before 取全部楼层，
 *  摘要顶替整段历史。对齐「摘要 [0, keepStart) + 正文 [keepStart, end) 顺序相接零重复」
 *  的两层记忆模型：before 是排他截止楼层，跨边界自动拆节点、不受外部系统自身滑动窗口限制。
 *  旧实现取的是对方自己的隐藏楼层集合，与本地正文窗口无关——全量降级会把最近楼层
 *  「摘要+全文」各发一遍。 */
export function getExternalSummary(windowStart: number): string | null {
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
    console.warn('[Choice] 获取记忆摘要失败:', e);
  }
  return null;
}
