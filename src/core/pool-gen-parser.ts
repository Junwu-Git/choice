/** 条目池解析逻辑：供 ImportEntriesDialog（粘贴导入）和 PoolChatDialog（AI 聊天生成）共享。
 *  从 ImportEntriesDialog.vue 提取，保持纯函数，不依赖 Vue 响应式。 */

/** 分组头：## 分组名 或 [分组名]，独占一行 */
export const GROUP_HEADER_RE = /^(?:##\s+(.+)|\[(.+)\])\s*$/;

/** 行内标签正则 */
export const PINNED_RE = /\[(?:固定|pinned|p)\]/i;
export const WEIGHT_RE = /\[(?:权重|weight|w)[:：]\s*(\d+(?:\.\d+)?)\]/i;
export const CONDITION_RE = /\[(?:条件|condition|c)[:：]\s*(.+?)\]/i;

/** 去除行首列表标记（1. 2) 3、 - • * 等），编号分隔符后须非数字，避免误吞 "10.5" 开头的条目 */
export const stripMarker = (l: string) => l.replace(/^\s*(?:\d+[.)、](?!\d)|[-•*])\s*/, '').trim();

/** 剥离行内标签，返回纯净文本 + 标签值 */
export function stripEntryTags(raw: string): {
  text: string;
  pinned?: boolean;
  weight?: number;
  condition?: string;
} {
  let text = raw;
  let pinned: boolean | undefined;
  let weight: number | undefined;
  let condition: string | undefined;

  if (PINNED_RE.test(text)) {
    pinned = true;
    text = text.replace(PINNED_RE, '').trim();
  }
  const wm = text.match(WEIGHT_RE);
  if (wm) {
    weight = parseFloat(wm[1]);
    text = text.replace(WEIGHT_RE, '').trim();
  }
  const cm = text.match(CONDITION_RE);
  if (cm) {
    condition = cm[1].trim();
    text = text.replace(CONDITION_RE, '').trim();
  }
  text = stripMarkdown(text);
  return { text, pinned, weight, condition };
}

export interface ParsedGroupEntry {
  text: string;
  tags: { pinned?: boolean; weight?: number; condition?: string };
}

export interface ParsedGroup {
  category: string;
  entries: ParsedGroupEntry[];
}

/**
 * 解析文本为分组条目数组。
 * @param rawText 待解析的原始文本
 * @param defaultCategory 无分组头时的默认分组名（ImportEntriesDialog 用 targetCategory，PoolChatDialog 用空字符串）
 * @returns 分组条目数组
 */
export function parsePoolEntries(rawText: string, defaultCategory: string = ''): ParsedGroup[] {
  if (!rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/);
  const hasGroupHeaders = lines.some(line => GROUP_HEADER_RE.test(line.trim()));
  const groups: ParsedGroup[] = [];
  let curCategory = hasGroupHeaders ? '' : defaultCategory;
  let curEntries: ParsedGroupEntry[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(GROUP_HEADER_RE);
    if (m) {
      if (curEntries.length) {
        groups.push({ category: curCategory, entries: [...curEntries] });
        curEntries = [];
      }
      curCategory = (m[1] || m[2] || '').trim();
      continue;
    }
    const stripped = stripMarker(line);
    if (stripped) {
      const { text, pinned, weight, condition } = stripEntryTags(stripped);
      curEntries.push({ text, tags: { pinned, weight, condition } });
    }
  }
  if (curEntries.length) groups.push({ category: curCategory, entries: curEntries });
  return groups;
}

/** 清理文本中的 Markdown 格式标记（粗体/斜体/删除线），保留文本内容。
 *  正则替换顺序：先双字符标记（**、__）后单字符标记（*、_），避免单字符误匹配双字符的一半。 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1');
}

/** 计算分组条目总数 */
export function countEntries(groups: ParsedGroup[]): number {
  return groups.reduce((sum, g) => sum + g.entries.length, 0);
}