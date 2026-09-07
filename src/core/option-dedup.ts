// 生成后去重：标题判定 + 字符 bigram Jaccard，纯本地字符串运算，零 API 成本。
// 参照集 = 上一 AI 楼层当前代 ∪ 当前楼层既有代（同楼重新生成也防）。

export type DedupDetail = {
  candidate: string;
  reason: 'title' | 'jaccard';
  matchedRef: string;
  score?: number;
};

export type DedupResult = {
  kept: string[];
  droppedCount: number;
  details: DedupDetail[];
};

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
  // 标题仅精确匹配，避免中文短标题因单向包含被误杀。
  const isDup = (cand: string, ref: string): { dup: boolean; detail?: DedupDetail } => {
    const ct = titleOf(cand);
    const rt = titleOf(ref);
    if (ct && rt && ct === rt) {
      return { dup: true, detail: { candidate: cand, reason: 'title', matchedRef: ref, score: 1 } };
    }
    const score = jaccard(bigrams(contentOf(cand)), bigrams(contentOf(ref)));
    if (score >= threshold) {
      return { dup: true, detail: { candidate: cand, reason: 'jaccard', matchedRef: ref, score } };
    }
    return { dup: false };
  };

  const kept: string[] = [];
  let dropped = 0;
  const details: DedupDetail[] = [];
  for (const cand of candidates) {
    let dup = false;
    let detail: DedupDetail | undefined;
    for (const ref of references) {
      const result = isDup(cand, ref);
      if (result.dup) {
        dup = true;
        detail = result.detail;
        break;
      }
    }
    if (dup) {
      dropped++;
      if (detail) details.push(detail);
    } else {
      kept.push(cand);
    }
  }
  return { kept, droppedCount: dropped, details };
}
