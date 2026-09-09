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
  // 标题匹配的内容门槛 = max(0, 用户阈值 - 0.35)。默认 0.75 → 0.4，保持现状；
  // 用户调高阈值时标题门槛同步上浮，调低时标题门槛下探至 0（单靠标题即可判重）。
  const titleGate = Math.max(0, threshold - 0.35);
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
  // 标题精确匹配后增加内容 bigram Jaccard 门槛（>0.4），避免 type 相同但内容不同的选项被误杀。
  const isDup = (cand: string, ref: string): { dup: boolean; detail?: DedupDetail } => {
    const ct = titleOf(cand);
    const rt = titleOf(ref);
    if (ct && rt && ct === rt) {
      // 标题匹配的内容门槛由用户阈值派生，保持与 UI 同步。
      const contentJaccard = jaccard(bigrams(contentOf(cand)), bigrams(contentOf(ref)));
      if (contentJaccard > titleGate) {
        return { dup: true, detail: { candidate: cand, reason: 'title', matchedRef: ref, score: contentJaccard } };
      }
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
