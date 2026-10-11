import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DICE_MARKER_TAIL,
  buildDiceMarker,
  degreeBucket,
  degreeSpace,
  degreeTierFor,
  diceMargin,
  judgeOutcome,
  marginDegree,
  rollDice,
  type DiceTemplates,
} from '@/core/dice';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('judgeOutcome（high 难度制）', () => {
  it('value ≥ target 成功、< target 失败', () => {
    expect(judgeOutcome(75, 50, 96, 5)).toBe('success');
    expect(judgeOutcome(49, 50, 96, 5)).toBe('fail');
  });

  it('彩蛋优先于成败：值 < target 的大成功仍判大成功', () => {
    expect(judgeOutcome(96, 100, 96, 5)).toBe('crit_success');
    // value ≥ target 的普通成功也先过大失败阈值
    expect(judgeOutcome(4, 1, 96, 5)).toBe('crit_fail');
  });

  it('两段彩蛋阈值倒挂（low ≥ high）时双双失效，退化为纯成败', () => {
    expect(judgeOutcome(100, 50, 5, 96)).toBe('success');
    expect(judgeOutcome(1, 50, 5, 96)).toBe('fail');
  });
});

describe('judgeOutcome（low COC 百分位）', () => {
  it('value ≤ target 成功、> target 失败', () => {
    expect(judgeOutcome(50, 50, 10, 96, 'low')).toBe('success');
    expect(judgeOutcome(51, 50, 10, 96, 'low')).toBe('fail');
  });

  it('low 模式彩蛋语义反转：小点数大成功、大点数大失败', () => {
    expect(judgeOutcome(5, 50, 10, 96, 'low')).toBe('crit_success');
    expect(judgeOutcome(96, 50, 10, 96, 'low')).toBe('crit_fail');
    expect(judgeOutcome(99, 50, 99, 100, 'low')).toBe('crit_success');
    expect(judgeOutcome(100, 50, 99, 100, 'low')).toBe('crit_fail');
  });

  it('low 模式彩蛋重叠（critS ≥ critF）退化为纯成败', () => {
    expect(judgeOutcome(1, 50, 50, 50, 'low')).toBe('success');
  });
});

describe('judgeOutcome 骰式值域 bounds', () => {
  it('high：彩蛋阈值按值域 clamp（146 不被 D100 硬钳到 100）', () => {
    const b = { min: 2, max: 150 };
    expect(judgeOutcome(146, 100, 146, 40, 'high', b)).toBe('crit_success');
    expect(judgeOutcome(2, 100, 146, 2, 'high', b)).toBe('crit_fail');
  });

  it('low：阈值同样按值域 clamp', () => {
    const b = { min: 2, max: 150 };
    expect(judgeOutcome(5, 100, 10, 140, 'low', b)).toBe('crit_success');
    expect(judgeOutcome(145, 100, 10, 140, 'low', b)).toBe('crit_fail');
  });
});

describe('rollDice', () => {
  it('D100 值域 1–100；mock 0.999 时 roll=100 → 大成功', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { roll, outcome } = rollDice(50, 96, 5);
    expect(roll).toBe(100);
    expect(outcome).toBe('crit_success');
  });
});

describe('diceMargin', () => {
  it('high = roll − rate；low = rate − roll；恰好达标为 0', () => {
    expect(diceMargin('high', 70, 50)).toBe(20);
    expect(diceMargin('low', 30, 65)).toBe(35);
    expect(diceMargin('high', 50, 50)).toBe(0);
    expect(diceMargin('low', 65, 65)).toBe(0);
  });
});

describe('degreeSpace', () => {
  it('high：成功面 [rate,100]、失败面 [1,rate)，均含边界', () => {
    expect(degreeSpace('high', 36)).toEqual({ success: 65, fail: 35 });
  });

  it('low：成功面 [1,rate]、失败面 (rate,100]', () => {
    expect(degreeSpace('low', 65)).toEqual({ success: 65, fail: 35 });
  });

  it('rate 越界钳进值域，防负空间', () => {
    expect(degreeSpace('high', 150)).toEqual({ success: 1, fail: 99 });
    expect(degreeSpace('high', 0)).toEqual({ success: 100, fail: 0 });
  });
});

describe('degreeBucket（v73 占比制）', () => {
  it('彩蛋为单条：tier null + 固定词，不受 margin 符号影响', () => {
    expect(degreeBucket('crit_success', -3, { mode: 'high', rate: 99 })).toEqual({ tier: null, word: '惊艳无比' });
    expect(degreeBucket('crit_fail', 50, { mode: 'high', rate: 36 })).toEqual({ tier: null, word: '灾难性失败' });
  });

  it('同一差值按需求值分档：36 需求差 39 → 完胜档；85 需求差 39 → 近满值档', () => {
    // 39/65 = 0.6 → mid_high
    expect(degreeBucket('success', 39, { mode: 'high', rate: 36 }).word).toBe('漂亮完胜');
    // 39/16 > 1 → clamp 1 → high
    expect(degreeBucket('success', 39, { mode: 'high', rate: 85 }).word).toBe('势如破竹');
  });

  it('占比断点：p=0.2 恰为 mid_low 下沿，p<0.2 落 low', () => {
    // 失败面 35：7/35 = 0.2 → mid_low；6/35 < 0.2 → low
    expect(degreeBucket('fail', -7, { mode: 'high', rate: 36 })).toEqual({ tier: 'mid_low', word: '功亏一篑' });
    expect(degreeBucket('fail', -6, { mode: 'high', rate: 36 })).toEqual({ tier: 'low', word: '差点成功' });
  });

  it('low 模式按成功面 [1,rate] 计占比', () => {
    // 35/65 ≈ 0.538 → mid；13/65 = 0.2 → mid_low
    expect(degreeBucket('success', 35, { mode: 'low', rate: 65 }).word).toBe('顺利达成');
    expect(degreeBucket('success', 13, { mode: 'low', rate: 65 }).word).toBe('险胜');
  });

  it('margin 0（恰好达标）落成功侧最低档', () => {
    expect(degreeBucket('success', 0, { mode: 'high', rate: 36 })).toEqual({ tier: 'low', word: '勉强得手' });
  });

  it('marginDegree/degreeTierFor 与 degreeBucket 同源', () => {
    const ctx = { mode: 'high' as const, rate: 36 };
    expect(marginDegree('success', 39, ctx)).toBe(degreeBucket('success', 39, ctx).word);
    expect(degreeTierFor('success', 39, ctx)).toBe('mid_high');
  });
});

describe('buildDiceMarker', () => {
  const T = (s: string): DiceTemplates => ({
    success: { low: s, mid_low: s, mid: s, mid_high: s, high: s },
    fail: { low: s, mid_low: s, mid: s, mid_high: s, high: s },
    critSuccess: s,
    critFail: s,
  });
  const tpl = T('掷出{roll}对{rate}超出{margin}，{degree}');

  it('三段结构：注释包裹 + 结构化头部 + 模板正文 + 纪律尾注', () => {
    const out = buildDiceMarker('success', 75, 36, tpl, tpl, 39, { mode: 'high', rate: 36 }, '潜入书房');
    expect(out.startsWith('<!--')).toBe(true);
    expect(out.endsWith('-->\n')).toBe(true);
    expect(out).toContain('结局 成功');
    expect(out).toContain('裁定对象 潜入书房');
    expect(out).toContain('点数 75｜需求 36｜差值 +39｜程度 漂亮完胜');
    expect(out).toContain('掷出75对36超出39，漂亮完胜');
    expect(out).toContain(DICE_MARKER_TAIL);
  });

  it('无标题时省略裁定对象段', () => {
    expect(buildDiceMarker('success', 75, 36, tpl, tpl, 39, { mode: 'high', rate: 36 })).not.toContain('裁定对象');
  });

  it('按档位取对应 send 模板（rate 36 / margin 39 → mid_high）', () => {
    const templates: DiceTemplates = {
      success: { low: 'SL', mid_low: 'SML', mid: 'SM', mid_high: 'SMH', high: 'SH' },
      fail: { low: 'FL', mid_low: 'FML', mid: 'FM', mid_high: 'FMH', high: 'FH' },
      critSuccess: 'CS',
      critFail: 'CF',
    };
    expect(buildDiceMarker('success', 75, 36, templates, templates, 39, { mode: 'high', rate: 36 })).toContain('SMH');
    expect(buildDiceMarker('fail', 26, 36, templates, templates, -10, { mode: 'high', rate: 36 })).toContain('FML');
    expect(buildDiceMarker('crit_success', 97, 36, templates, templates, 61, { mode: 'high', rate: 36 })).toContain(
      'CS',
    );
  });

  it('send 模板为空回退 fallback；两者皆空整体不注入', () => {
    const emptyMH: DiceTemplates = {
      ...T('X'),
      success: { low: 'X', mid_low: 'X', mid: 'X', mid_high: '', high: 'X' },
    };
    const fallback = T('FB');
    expect(buildDiceMarker('success', 75, 36, emptyMH, fallback, 39, { mode: 'high', rate: 36 })).toContain('FB');
    const bothEmpty: DiceTemplates = {
      ...T(''),
      success: { low: '', mid_low: '', mid: '', mid_high: '', high: '' },
    };
    expect(buildDiceMarker('success', 75, 36, bothEmpty, bothEmpty, 39, { mode: 'high', rate: 36 })).toBe('');
  });

  it('失败侧差值负号：差值 -10（无 + 号）', () => {
    expect(buildDiceMarker('fail', 26, 36, tpl, tpl, -10, { mode: 'high', rate: 36 })).toContain('差值 -10');
  });

  it('连续连字符统一清洗，注释体内不会出现 --> 提前闭合', () => {
    const dirty = T('低--高{rate}，尾---线');
    const out = buildDiceMarker('success', 75, 36, dirty, dirty, 39, { mode: 'high', rate: 36 });
    // 剥掉首尾定界符（<!-- 与 -->\n）后检查内容——闭合符自身的 -- 不算泄漏
    const inner = out.slice(4, -4);
    expect(inner).not.toContain('--');
    expect(inner).toContain('低－高36');
  });
});
