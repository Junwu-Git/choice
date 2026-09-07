// 生成后去重：标题判定 + 字符 bigram Jaccard，纯本地字符串运算，零 API 成本。
// 参照集 = 上一 AI 楼层当前代 ∪ 当前楼层既有代（同楼重新生成也防）。

export type DedupResult = { kept: string[]; droppedCount: number };

export function dedupOptions(candidates: string[], references: string[], threshold: number): DedupResult {
  const titleOf = (s: string): string | null => {
    const m = s.match(/^\s*[\[【]([^\]】]+)[\]】]/);
    return m ? m[1] : null;
  };
  const contentOf = (s: string): string => {
    const idx = s.search(/^\s*[\[【][^\]】]+[\]】]\s*/);
    return idx >= 0 ? s.slice(idx).trim() : s.trim();
  };
  const normalize = (s: string): string => s.replace(/\s+/g, '').trim();
  const bigrams = (s: string): Set<string> => {
    const t = normalize(s);
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    let inter = 0;
    let union = 0;
    for (const x of a) {
      union++;
      if (b.has(x)) inter++;
    }
    for (const x of b) {
      if (!a.has(x)) union++;
    }
    return union === 0 ? 0 : inter / union;
  };
  const isDup = (cand: string, ref: string): boolean => {
    const ct = titleOf(cand);
    const rt = titleOf(ref);
    if (ct && rt) {
      if (ct === rt || ct.includes(rt) || rt.includes(ct)) return true;
    }
    return jaccard(bigrams(contentOf(cand)), bigrams(contentOf(ref))) >= threshold;
  };

  const kept: string[] = [];
  let dropped = 0;
  for (const cand of candidates) {
    let dup = false;
    for (const ref of references) {
      if (isDup(cand, ref)) { dup = true; break; }
    }
    if (!dup) {
      for (const ref of kept) {
        if (isDup(cand, ref)) { dup = true; break; }
      }
    }
    if (dup) dropped++;
    else kept.push(cand);
  }
  return { kept, droppedCount: dropped };
}
