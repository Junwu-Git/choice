/**
 * 聊天窗口的纯计算（可单测）。
 *
 *  为什么要有它：酒馆正则的提示词侧规则按 depth 限定作用楼层（minDepth/maxDepth），
 *  酒馆主生成的 depth 是「相对整段可见聊天」算的（script.js:4445：coreChat.length - index - 1）。
 *  本扩展此前用「截尾后的窗口长度」算 depth——轮数模式下窗口只有 20 条，同一条消息的
 *  depth 与酒馆差了一截，minDepth/maxDepth 规则在选项生成里的表现因此与主生成不同
 *  （「只保留最近 N 层」类正则会在两个链路里切在不同楼层）。
 */

/** 可见消息条数 + 该消息在可见序列中的位置 → 酒馆口径的 depth（0 = 距末尾最近一条）。 */
export function calcRegexDepth(visibleCount: number, visiblePos: number): number {
  return Math.max(0, visibleCount - visiblePos - 1);
}
