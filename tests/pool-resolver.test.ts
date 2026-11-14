import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePool, sortPoolByLibraryOrder } from '@/core/pool-resolver';
import type { PoolEntry } from '@/type/settings';

let seq = 0;
const entry = (over: Partial<PoolEntry> = {}): PoolEntry => ({
  id: `e${seq++}`,
  type: '行动',
  content: '内容',
  rule: '',
  pinned: false,
  weight: 1,
  category: '',
  ...over,
});

const run = (pool: PoolEntry[], over: Partial<Parameters<typeof resolvePool>[0]> = {}) =>
  resolvePool({
    effectivePool: pool,
    count: 3,
    categoriesEnabled: false,
    shuffleFinal: false,
    pinnedOverflow: 'send_all',
    oversamplePct: 0,
    ...over,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

// Math.random 恒返 0.999 时：shuffled 恒为恒等排列（floor(0.999×(i+1)) = i），
// weightedPick 的 key = rand^(1/w) 随 w 单调升 → 稳定排序后恒选权重最高者
const mockDeterministic = () => vi.spyOn(Math, 'random').mockReturnValue(0.999);

/** 按给定序列依次返回随机数（用尽后重复最后一个），用于构造指定的 Fisher-Yates 结果。 */
const mockRandomSequence = (...values: number[]) => {
  let i = 0;
  return vi.spyOn(Math, 'random').mockImplementation(() => values[Math.min(i++, values.length - 1)]);
};

describe('resolvePool 基本结构', () => {
  it('固定条目全部保留，非固定抽取量 = count − pinned，两者不重叠、不重复', () => {
    const pool = [
      entry({ pinned: true, id: 'p1' }),
      entry({ pinned: true, id: 'p2' }),
      ...Array.from({ length: 6 }, () => entry()),
    ];
    const { pinned, drawn } = run(pool, { count: 5 });
    expect(pinned.map(e => e.id)).toEqual(['p1', 'p2']);
    expect(drawn).toHaveLength(3);
    const all = [...pinned, ...drawn].map(e => e.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('固定溢出 trim：随机截断到 count，非固定抽 0', () => {
    const pool = Array.from({ length: 4 }, () => entry({ pinned: true }));
    const { pinned, drawn } = run(pool, { count: 2, pinnedOverflow: 'trim' });
    expect(pinned).toHaveLength(2);
    expect(drawn).toHaveLength(0);
  });

  it('固定溢出 send_all：固定全发、非固定不抽', () => {
    const pool = [entry({ pinned: true }), entry({ pinned: true }), entry(), entry()];
    const { pinned, drawn } = run(pool, { count: 1, pinnedOverflow: 'send_all' });
    expect(pinned).toHaveLength(2);
    expect(drawn).toHaveLength(0);
  });

  it('count 超过池大小：自然封顶为全池，不产生重复', () => {
    const pool = Array.from({ length: 4 }, () => entry());
    const { drawn } = run(pool, { count: 10 });
    expect(drawn).toHaveLength(4);
    expect(new Set(drawn.map(e => e.id)).size).toBe(4);
  });

  it('count 0：不抽任何条目', () => {
    const { drawn } = run(
      Array.from({ length: 4 }, () => entry()),
      { count: 0 },
    );
    expect(drawn).toHaveLength(0);
  });
});

describe('菜单模式超采样（oversamplePct）', () => {
  it('100% 时候选量翻倍（3 → 6）', () => {
    const pool = Array.from({ length: 10 }, () => entry());
    expect(run(pool, { count: 3, oversamplePct: 100 }).drawn).toHaveLength(6);
  });

  it('0% 精确退化为 1:1', () => {
    expect(
      run(
        Array.from({ length: 10 }, () => entry()),
        { count: 3, oversamplePct: 0 },
      ).drawn,
    ).toHaveLength(3);
  });

  it('候选量被池大小封顶（池 4、count 3、300% → 4）', () => {
    expect(
      run(
        Array.from({ length: 4 }, () => entry()),
        { count: 3, oversamplePct: 300 },
      ).drawn,
    ).toHaveLength(4);
  });

  it('非法 pct（NaN/负数/非数值）按 0 处理，不扩散 NaN', () => {
    const pool = Array.from({ length: 10 }, () => entry());
    for (const pct of [Number.NaN, -50, 'x' as unknown as number]) {
      expect(run(pool, { count: 3, oversamplePct: pct }).drawn).toHaveLength(3);
    }
  });
});

describe('加权抽取', () => {
  it('高权重条目被优先抽中', () => {
    mockDeterministic();
    const pool = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'big', weight: 10 }), entry({ id: 'd' })];
    expect(run(pool, { count: 1 }).drawn.map(e => e.id)).toEqual(['big']);
  });

  it('权重 0 的条目不被抽中（key→0 沉底）', () => {
    mockDeterministic();
    const pool = [entry({ id: 'zero', weight: 0 }), entry({ id: 'one', weight: 1 })];
    expect(run(pool, { count: 1 }).drawn.map(e => e.id)).toEqual(['one']);
  });

  it('非法权重（NaN/负数）按 1 兜底', () => {
    mockDeterministic();
    const pool = [entry({ id: 'nan', weight: Number.NaN }), entry({ id: 'w2', weight: 2 })];
    expect(run(pool, { count: 1 }).drawn.map(e => e.id)).toEqual(['w2']);
  });

  it('统计性：weight 100 对 weight 1 呈显著优势（300 轮 ≥ 80%）', () => {
    const pool = [entry({ id: 'heavy', weight: 100 }), entry({ id: 'light', weight: 1 })];
    let heavy = 0;
    for (let i = 0; i < 300; i++) {
      if (run(pool, { count: 1 }).drawn[0]?.id === 'heavy') heavy++;
    }
    expect(heavy).toBeGreaterThanOrEqual(240);
  });
});

describe('分类轮询抽取', () => {
  it('小分类先耗尽后由大分类补齐：A×4 + B×1 抽 4 → 3A + 1B，B 不被饿死', () => {
    mockDeterministic();
    const pool = [...Array.from({ length: 4 }, () => entry({ category: 'A' })), entry({ category: 'B' })];
    const { drawn } = run(pool, { count: 4, categoriesEnabled: true });
    expect(drawn.filter(e => e.category === 'A')).toHaveLength(3);
    expect(drawn.filter(e => e.category === 'B')).toHaveLength(1);
  });

  it('同池同量关闭分类：等权按序占满，小分类可能整组落选（对照组）', () => {
    mockDeterministic();
    const pool = [...Array.from({ length: 4 }, () => entry({ category: 'A' })), entry({ category: 'B' })];
    const { drawn } = run(pool, { count: 4, categoriesEnabled: false });
    expect(drawn.filter(e => e.category === 'B')).toHaveLength(0);
  });
});

describe('sortPoolByLibraryOrder — 条目库显示顺序', () => {
  it('命名分组按 group_order，未收录分组按名称补后，未分组恒最后；组内保持原顺序', () => {
    const pool = [
      entry({ id: 'u1', category: '' }),
      entry({ id: 'b1', category: 'B' }),
      entry({ id: 'a1', category: 'A' }),
      entry({ id: 'a2', category: 'A' }),
      entry({ id: 'c1', category: 'C' }),
      entry({ id: 'b2', category: 'B' }),
    ];
    expect(sortPoolByLibraryOrder(pool, ['B', 'A']).map(e => e.id)).toEqual(['b1', 'b2', 'a1', 'a2', 'c1', 'u1']);
  });

  it('group_order 的空串/重复/已不存在分组被忽略', () => {
    const pool = [entry({ id: 'a1', category: 'A' }), entry({ id: 'b1', category: 'B' }), entry({ id: 'u1' })];
    expect(sortPoolByLibraryOrder(pool, ['', 'A', 'A', 'missing', 'B']).map(e => e.id)).toEqual(['a1', 'b1', 'u1']);
  });

  it('分类名去空白后归组（与条目库分组同口径）', () => {
    const pool = [entry({ id: 'a1', category: ' A ' }), entry({ id: 'b1', category: 'B' })];
    expect(sortPoolByLibraryOrder(pool, ['A']).map(e => e.id)).toEqual(['a1', 'b1']);
  });
});

describe('关闭打乱结果时的候选顺序', () => {
  it('分类轮询先抽到 A2、B1 也排回条目库顺序', () => {
    mockDeterministic();
    const pool = [
      entry({ id: 'a1', category: 'A' }),
      entry({ id: 'a2', category: 'A' }),
      entry({ id: 'a3', category: 'A' }),
      entry({ id: 'b1', category: 'B' }),
    ];
    const { drawn } = run(pool, { count: 3, categoriesEnabled: true });
    expect(drawn.map(e => e.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('固定条目 trim 随机截断后仍按条目库顺序返回', () => {
    // 截断先打乱：[p1,p2,p3] → [p3,p2,p1]，取前 2 = [p3,p2]；再排回库顺序
    mockRandomSequence(0, 0.9);
    const pool = [
      entry({ id: 'p1', pinned: true }),
      entry({ id: 'p2', pinned: true }),
      entry({ id: 'p3', pinned: true }),
    ];
    const { pinned } = run(pool, { count: 2, pinnedOverflow: 'trim' });
    expect(pinned.map(e => e.id)).toEqual(['p2', 'p3']);
  });
});
