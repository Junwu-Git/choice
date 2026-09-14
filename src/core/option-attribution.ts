import type { PoolEntry } from '@/type/settings';

/**
 * 选项→条目精确归因（纯函数）：生成时把每条输出选项近似归属到当轮候选条目，
 * 结果随消息持久化（options[].matchedEntryId），统计「命中」只对匹配条目计数——
 * 被 AI 舍弃的候选不产生命中，AI 自由发挥的选项无归属。
 * 选项是 AI 自由文本，归属为启发式：优先 type 前缀精确匹配，否则字符 2-gram
 * Dice 相似度阈值兜底。阈值常量 OPTION_MATCH_THRESHOLD（settings.ts）集中可调。
 */

/** 条目匹配特征串：type + content 拼接（rule 是写作约束，不参与匹配） */
export const buildEntrySignal = (entry: PoolEntry): string => entry.type + entry.content;

/** 去空白归一（中文二元组对空白不敏感，去除避免「type 内容」与「type内容」失配） */
const normalize = (s: string): string => s.replace(/\s+/g, '');

/** 字符串的字符二元组集合（中文短文本的次序敏感特征，实现简单） */
const bigrams = (s: string): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

/** Dice 系数 = 2|A∩B| / (|A|+|B|)，对文本长度差异不敏感（Jaccard 在长选项上稀释严重） */
const dice = (a: string, b: string): number => {
  const sa = bigrams(a);
  if (sa.size === 0) return 0;
  const sb = bigrams(b);
  if (sb.size === 0) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter += 1;
  return (2 * inter) / (sa.size + sb.size);
};

/**
 * 选项正文是否以候选 type 起始（允许紧跟正文无分隔，如「顺势行动武…」）。
 * 不做边界字符要求：池内 type 互相独立（「顺势行动」非「NSFW·顺势而为」前缀），
 * 短 type 误配风险低；加边界反而会漏掉无空格的常见输出格式。
 */
const startsWithType = (optionText: string, type: string): boolean => type.length > 0 && optionText.startsWith(type);

/**
 * 匹配单条选项到候选条目：
 * 1. 提取括号标题壳（parse 主路径会保留 [标题]/【标题】，标题即 AI 给选项起的方向名），
 *    标题与正文一起参与匹配——此前整壳剥掉会把类型信息一并丢掉、前缀匹配全部失效；
 * 2. type 前缀精确匹配 → 直接认定（用户数据 type 基本唯一，AI 常以 type 名作标题前缀）；
 * 3. 否则对全部候选算 2-gram Dice，最高分 ≥ threshold 取唯一归属；低于阈值返回 null。
 */
export function matchOptionToEntry(optionText: string, candidates: PoolEntry[], threshold: number): string | null {
  const raw = optionText.trim();
  if (!raw || candidates.length === 0) return null;
  const bracket = raw.match(/^[[【]([^\]】]+)[\]】]\s*/);
  const title = bracket ? bracket[1].trim() : '';
  const body = bracket ? raw.slice(bracket[0].length) : raw;
  const checkText = title ? `${title} ${body}`.trim() : raw;
  for (const e of candidates) {
    if (startsWithType(checkText, e.type.trim())) return e.id;
  }
  const text = normalize(checkText);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const e of candidates) {
    const score = dice(text, normalize(buildEntrySignal(e)));
    if (score > bestScore) {
      bestScore = score;
      bestId = e.id;
    }
  }
  return bestScore >= threshold ? bestId : null;
}
