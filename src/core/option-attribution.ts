import type { PoolEntry } from '@/type/settings';

/**
 * 选项→条目精确归因（纯函数）：生成时把每条输出选项近似归属到当轮候选条目，
 * 结果随消息持久化（options[].matchedEntryId），统计「命中」只对匹配条目计数——
 * 被 AI 舍弃的候选不产生命中，AI 自由发挥的选项无归属。
 * 选项是 AI 自由文本，归属为启发式：type 前缀精确匹配优先，否则字符 2-gram
 * Dice 相似度阈值兜底。阈值常量 OPTION_MATCH_THRESHOLD（settings.ts）集中可调。
 */

/** 条目匹配特征串：type + content 拼接（rule 是写作约束，不参与匹配；
 *  契约 = type 非空且直接拼接 content，改动时与展示层（entrySummary）保持同步） */
const buildEntrySignal = (entry: PoolEntry): string => entry.type + entry.content;

/** 去空白归一（中文二元组对空白不敏感，去除避免「type 内容」与「type内容」失配） */
const normalize = (s: string): string => s.replace(/\s+/g, '');

/** 字符串的字符二元组集合（中文短文本的次序敏感特征，实现简单） */
const bigrams = (s: string): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

/** Dice 系数 = 2|A∩B| / (|A|+|B|)，对文本长度差异不敏感（Jaccard 在长选项上稀释严重） */
const dice = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return (2 * inter) / (a.size + b.size);
};

/**
 * 选项正文是否以候选 type 起始（允许紧跟正文无分隔，如「顺势行动武…」）。
 * 不加边界字符要求：池内 type 显式按「最长优先」匹配（见 prepareMatchSignals，
 * 排序后首个命中即最长），前缀包含型（「战斗」/「战斗策略」）不会误配到短型
 */
const startsWithType = (optionText: string, type: string): boolean => type.length > 0 && optionText.startsWith(type);

/** 候选条目的预计算匹配信号（一轮生成只构造一次，避免每条选项×每个候选重复造 bigram） */
export type EntryMatchSignal = {
  id: string;
  /** 归一化的 type（供前缀匹配；type 去掉空白保证与 checkText 同基准） */
  type: string;
  /** 归一化的 type+content 信号（Dice 兜底用） */
  text: string;
  /** text 的字符二元组集合（预计算，Dice 直接复用） */
  bigrams: Set<string>;
};

/**
 * 预计算候选匹配信号（每轮生成调用一次）：
 * type 按长度降序排序——前缀匹配循环里首个命中即「最长 type」，避免
 * 「战斗」与「战斗策略」叠加时把「战斗策略…」开头选项误配到短型。
 */
export function prepareMatchSignals(candidates: PoolEntry[]): EntryMatchSignal[] {
  return candidates
    .map(e => {
      const text = normalize(buildEntrySignal(e));
      return { id: e.id, type: e.type.trim(), text, bigrams: bigrams(text) };
    })
    .sort((a, b) => b.type.length - a.type.length);
}

/**
 * 匹配单条选项到候选条目：
 * 1. 提取括号标题壳（parse 主路径会保留 [标题]/【标题】，标题即 AI 给选项起的方向名），
 *    标题与正文一起参与匹配——此前整壳剥掉会把类型信息一并丢掉、前缀匹配全部失效；
 * 2. type 前缀精确匹配（信号已按 type 长度降序，取首个命中 = 最长 type）→ 直接认定；
 * 3. 否则对全部候选算 2-gram Dice（bigram 预计算复用），最高分 ≥ threshold 取唯一归属。
 */
export function matchOptionToEntry(optionText: string, signals: EntryMatchSignal[], threshold: number): string | null {
  const raw = optionText.trim();
  if (!raw || signals.length === 0) return null;
  const bracket = raw.match(/^[[【]([^\]】]+)[\]】]\s*/);
  const title = bracket ? bracket[1].trim() : '';
  const body = bracket ? raw.slice(bracket[0].length) : raw;
  const checkText = title ? `${title} ${body}`.trim() : raw;
  for (const s of signals) {
    if (startsWithType(checkText, s.type)) return s.id;
  }
  const text = normalize(checkText);
  const optionBigrams = bigrams(text);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const s of signals) {
    const score = dice(optionBigrams, s.bigrams);
    if (score > bestScore) {
      bestScore = score;
      bestId = s.id;
    }
  }
  return bestScore >= threshold ? bestId : null;
}
