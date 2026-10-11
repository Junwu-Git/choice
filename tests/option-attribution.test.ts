import { describe, expect, it } from 'vitest';
import { matchOptionToEntry, prepareMatchSignals } from '@/core/option-attribution';
import type { PoolEntry } from '@/type/settings';

// 归因阈值与 OPTION_MATCH_MARGIN 同源口径：本地匹配阈值 0.25（bigram Dice 下限）
const THRESHOLD = 0.25;

const mkEntry = (over: Partial<PoolEntry> & Pick<PoolEntry, 'id' | 'type' | 'content'>): PoolEntry => ({
  rule: '',
  pinned: false,
  weight: 1,
  category: '',
  ...over,
});

describe('prepareMatchSignals', () => {
  it('type 按长度降序，前缀循环首个命中即最长 type', () => {
    const signals = prepareMatchSignals([
      mkEntry({ id: 'short', type: '战斗', content: '内容' }),
      mkEntry({ id: 'long', type: '战斗策略', content: '内容' }),
    ]);
    expect(signals.map(s => s.id)).toEqual(['long', 'short']);
  });
});

describe('matchOptionToEntry', () => {
  const candidates = [
    mkEntry({ id: 'a', type: '战斗', content: '近身搏斗压制对手' }),
    mkEntry({ id: 'b', type: '战斗策略', content: '佯攻后撤退拉扯阵型' }),
    mkEntry({ id: 'c', type: '遭遇', content: '黑森林夜间遭遇狼群' }),
    mkEntry({ id: 'd', type: '休整', content: '在旅店休息恢复体力' }),
  ];
  const signals = prepareMatchSignals(candidates);

  it('type 前缀精确匹配（长型优先，不被短型抢走）', () => {
    expect(matchOptionToEntry('战斗策略撤退', signals, THRESHOLD)).toEqual({ id: 'b', via: 'prefix' });
  });

  it('括号标题参与前缀匹配（标题壳保留类型信息）', () => {
    expect(matchOptionToEntry('[战斗]正面突击', signals, THRESHOLD)).toEqual({ id: 'a', via: 'prefix' });
  });

  it('Dice 兜底：与唯一候选相似度达标且领先幅度 ≥ margin', () => {
    // 与 c（遭遇黑森林夜间遭遇狼群）共享「黑森/森林/林夜/夜间/狼群」等 bigram，与 d 零重叠
    const m = matchOptionToEntry('[黑森林]夜间与狼群正面相遇', signals, THRESHOLD);
    expect(m).toEqual({ id: 'c', via: 'dice' });
  });

  it('平票不归属：两个相同信号得分差 < margin → null（宁缺勿错）', () => {
    const tie = prepareMatchSignals([
      mkEntry({ id: 'x', type: '遭遇', content: '黑森林夜间遭遇狼群' }),
      mkEntry({ id: 'y', type: '遭遇', content: '黑森林夜间遭遇狼群' }),
    ]);
    expect(matchOptionToEntry('[黑森林]夜间与狼群正面相遇', tie, THRESHOLD)).toEqual({ id: null, via: null });
  });

  it('低于阈值不归属', () => {
    expect(matchOptionToEntry('完全不相干的另类行动', signals, THRESHOLD)).toEqual({ id: null, via: null });
  });

  it('空选项 / 空候选 / 空 type 均安全返回未命中', () => {
    expect(matchOptionToEntry('', signals, THRESHOLD)).toEqual({ id: null, via: null });
    expect(matchOptionToEntry('[战斗]突击', [], THRESHOLD)).toEqual({ id: null, via: null });
    const noType = prepareMatchSignals([mkEntry({ id: 'z', type: '', content: '黑森林夜间遭遇狼群' })]);
    expect(matchOptionToEntry('黑森林夜间撞上狼群', noType, THRESHOLD).via).toBe('dice');
  });
});
