/**
 * 条目展示摘要（折叠行标识）。
 *
 * 为什么独立成模块：PoolEditor 与 SelectEntriesDialog 的折叠摘要逻辑完全相同
 * （type 优先截断 50、无 type 用 content 截断 30、去引号、空则占位标签），
 * 此前两份拷贝各自实现。EntryPoolDialog 用的是更丰富的 `type | content` 格式
 * （弹窗行需要更多辨识信息），属有意差异，不并入。
 * emptyLabel 由调用方传 t 包裹的文案——本模块保持纯函数，不引入 i18n。
 */

/** 条目标识文本：type 优先（截断 maxType），否则 content 首段（截断 maxContent），全空返回 emptyLabel */
export function entrySummaryText(
  type: string,
  content: string,
  emptyLabel: string,
  maxType = 50,
  maxContent = 30,
): string {
  const t = type.trim();
  if (t) return t.replace(/"/g, '').slice(0, maxType);
  const c = content.trim();
  // 无类型的条目以内容首段充当标识，否则折叠行全空白
  if (c) return c.replace(/"/g, '').slice(0, maxContent);
  return emptyLabel;
}
