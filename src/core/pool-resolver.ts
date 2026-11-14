import type { PoolEntry } from '@/type/settings';

type ResolvePoolInput = {
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

type ResolvePoolResult = {
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
    // 与条目库分组同口径：分类名去空白后归组（否则「 A」与「A」会被当成两组）
    const key = (entry.category || '').trim();
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

/** 条目库的显示顺序（与 EntryPoolDialog 的 groupedEntries 同口径）：
 *  命名分组按 group_order，未收录的分组按名称补后，「未分组」恒最后；组内保持入参顺序。
 *  为什么需要它：effectivePool 直接来自 master_pool 存储序，分组拖拽后组间顺序会与
 *  条目库页面不一致；「打乱结果」关闭时用户期望候选按自己在条目库里看到的顺序排列。 */
export function sortPoolByLibraryOrder(entries: PoolEntry[], groupOrder: readonly string[]): PoolEntry[] {
  const groups = new Map<string, PoolEntry[]>();
  for (const entry of entries) {
    const key = (entry.category || '').trim();
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(entry);
  }
  const orderedKeys: string[] = [];
  const used = new Set<string>();
  for (const raw of groupOrder) {
    const key = raw.trim();
    // 空串不是用户分组；重复键与已不存在的分组跳过，避免同一组出现两次
    if (!key || used.has(key) || !groups.has(key)) continue;
    orderedKeys.push(key);
    used.add(key);
  }
  const rest = [...groups.keys()].filter(key => key !== '' && !used.has(key)).sort((a, b) => a.localeCompare(b));
  orderedKeys.push(...rest);
  if (groups.has('')) orderedKeys.push('');
  return orderedKeys.flatMap(key => groups.get(key) ?? []);
}

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

  // 关闭「打乱结果」：把抽取/截断后的子集排回 effectivePool 的原始顺序（= 条目库显示顺序）。
  // 抽取本身仍随机（权重/分类决定选中谁），这里只恢复「选中项之间的相对顺序」。
  const byPoolOrder = (list: PoolEntry[]): PoolEntry[] => {
    if (input.shuffleFinal) return list;
    const order = new Map(input.effectivePool.map((e, index) => [e.id, index]));
    return [...list].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  };

  // shuffleFinal 时分别打乱 pinned/drawn，确保发给 AI 的提示词顺序随机。
  // 不再返回合并的 selected/underflow：唯一消费方 generator 只读 pinned/drawn，
  // 之前的 selected 合并 + 单独 shuffle 属未被消费的死计算
  return {
    pinned: input.shuffleFinal ? shuffled(pinnedUsed) : byPoolOrder(pinnedUsed),
    drawn: input.shuffleFinal ? shuffled(drawn) : byPoolOrder(drawn),
  };
}
