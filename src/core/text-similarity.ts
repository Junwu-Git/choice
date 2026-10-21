/**
 * 文本相似度工具（纯函数）：选项归因与知识边界去重共用。
 *
 * 为什么抽出来：两处都在做「中文短文本是否指同一件事」的判断，此前各写一份归一化/
 * 二元组/Dice，改一处阈值或归一规则另一处不跟随，会出现「统计说命中、知识表却重复」
 * 这类口径分裂。相似度是纯计算，集中后可直接单测边界。
 */

/** 去空白归一（中文二元组对空白不敏感，去除避免「type 内容」与「type内容」失配） */
export const normalizeText = (s: string): string => s.replace(/\s+/g, '');

/** 字符串的字符二元组集合（中文短文本的次序敏感特征，实现简单） */
export const bigramsOf = (s: string): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

/** Dice 系数 = 2|A∩B| / (|A|+|B|)，对文本长度差异不敏感（Jaccard 在长文本上稀释严重） */
export const diceCoefficient = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return (2 * inter) / (a.size + b.size);
};

/** 两个字符串的 Dice 相似度（内部做归一化与二元组，供一次性比较） */
export const textSimilarity = (a: string, b: string): number =>
  diceCoefficient(bigramsOf(normalizeText(a)), bigramsOf(normalizeText(b)));
