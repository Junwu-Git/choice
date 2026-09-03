import type { PoolEntry } from '@/type/settings';

export type ResolvePoolInput = {
  effectivePool: PoolEntry[];
  count: number;
  categoriesEnabled: boolean;
  shuffleFinal: boolean;
  pinnedOverflow: 'send_all' | 'trim';
  /**
   * 菜单模式超采样百分比（GenerationSettings.oversample_pct，0-300）。
   * 非固定条目抽取量 = remaining + ceil(remaining × pct/100)：候选多于所需，
   * 发给 AI 作为"方向候选菜单"，由 AI 按场景贴合度挑选（挑选语义由提示词承担，
   * 本函数只负责把菜单变大）。0 = 关闭菜单模式，精确退化为 1:1（v23 前行为）。
   * 池小于抽取量时 drawByCategories/weightedPick 自然封顶为全发，行为无突变。
   * 职责分离：weight/category 抽样分布决定"菜单上有什么"，AI 决定"点什么"。
   */
  oversamplePct: number;
};

export type ResolvePoolResult = {
  pinned: PoolEntry[];
  drawn: PoolEntry[];
};

const shuffled = <T>(list: T[]): T[] => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const safeWeight = (entry: PoolEntry): number => {
  const w = entry.weight;
  return typeof w === 'number' && Number.isFinite(w) && w >= 0 ? w : 1;
};

/** 菜单模式抽取量：remaining + ceil(remaining × pct/100)，再被池大小自然封顶。
 *  pct 非有限数时按 0 处理（防御运行时被绕过 zod 的历史对象污染，静默退化而非 NaN 扩散）；
 *  ceil 保证 50% 时奇数 remaining 也至少多抽 1 条（如 remaining=3 → 抽 5 而非 4）。 */
const drawAmount = (pool: PoolEntry[], remaining: number, oversamplePct: number): number => {
  const pct =
    typeof oversamplePct === 'number' && Number.isFinite(oversamplePct) && oversamplePct > 0 ? oversamplePct : 0;
  const overflow = Math.ceil((remaining * pct) / 100);
  return Math.min(remaining + overflow, pool.length);
};

const weightedPick = (entries: PoolEntry[], amount: number): PoolEntry[] => {
  return shuffled(entries)
    .map(entry => ({ entry, key: Math.pow(Math.random(), 1 / Math.max(safeWeight(entry), 0.0001)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, amount)
    .map(item => item.entry);
};

const drawByCategories = (pool: PoolEntry[], amount: number): PoolEntry[] => {
  if (amount <= 0 || pool.length === 0) {
    return [];
  }
  const groups = new Map<string, PoolEntry[]>();
  for (const entry of pool) {
    const key = entry.category || '';
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(entry);
  }
  const groupOrder = shuffled([...groups.keys()]);
  const drawn: PoolEntry[] = [];
  while (drawn.length < amount) {
    let pickedAny = false;
    for (const key of groupOrder) {
      if (drawn.length >= amount) {
        break;
      }
      const group = groups.get(key);
      if (!group || group.length === 0) {
        continue;
      }
      const pick = weightedPick(group, 1)[0];
      group.splice(group.indexOf(pick), 1);
      drawn.push(pick);
      pickedAny = true;
    }
    if (!pickedAny) {
      break;
    }
  }
  return drawn;
};

export function resolvePool(input: ResolvePoolInput): ResolvePoolResult {
  const pinned = input.effectivePool.filter(entry => entry.pinned);
  const pool = input.effectivePool.filter(entry => !entry.pinned);

  let pinnedUsed = pinned;
  let remaining = 0;
  if (pinnedUsed.length > input.count) {
    if (input.pinnedOverflow === 'trim') {
      // 随机截断：先打乱再取前 count 条，避免总是截掉末尾的条目
      pinnedUsed = shuffled(pinnedUsed).slice(0, input.count);
      remaining = 0;
    } else {
      remaining = 0;
    }
  } else {
    remaining = Math.max(input.count - pinnedUsed.length, 0);
  }

  const drawn = input.categoriesEnabled
    ? drawByCategories(pool, drawAmount(pool, remaining, input.oversamplePct))
    : weightedPick(pool, drawAmount(pool, remaining, input.oversamplePct));

  // shuffleFinal 时分别打乱 pinned/drawn，确保发给 AI 的提示词顺序随机。
  // 不再返回合并的 selected/underflow：唯一消费方 generator 只读 pinned/drawn，
  // 之前的 selected 合并 + 单独 shuffle 属未被消费的死计算
  return {
    pinned: input.shuffleFinal ? shuffled(pinnedUsed) : pinnedUsed,
    drawn: input.shuffleFinal ? shuffled(drawn) : drawn,
  };
}
