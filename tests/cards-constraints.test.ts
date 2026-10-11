import { describe, expect, it } from 'vitest';
import {
  CARD_DUPLICATE_VALUE,
  CARD_DROP_WEIGHT,
  CARD_PACK_OFFER,
  CARD_PACK_PRICE,
  cardMaxDurability,
  cardRepairCost,
  checkDeckBudget,
  clampEffect,
  isCardBroken,
  isHighStar,
  sanitizeNarrative,
  validateCard,
} from '@/core/cards-constraints';
import type { Card, CardEffect, CardStar } from '@/type/settings';

const mkCard = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  name: '测试卡',
  type: 'weapon',
  star: '3',
  trigger: { kind: 'outcome', typeValue: '', grade: null, min: 0, max: 0, outcome: 'success' },
  effects: [{ kind: 'roll_bonus', amount: 5 }],
  narrative: '',
  source: 'builtin',
  character_id: '',
  character_name: '',
  ...over,
});

describe('卡牌经济防刷不变量', () => {
  // 注释即契约（cards-constraints.ts CARD_DUPLICATE_VALUE）：按掉落权重加权的单抽期望
  // 回币 ×3（开包固定展示 3 张）必须 < 卡包价，否则集齐后「买包→全选重复」净赚成货币循环。
  // 旧档（2/3/5/8）期望 ≈6.4 已踩线收回——此测试钉死不变量，调档前必看。
  it('单抽期望回币 × CARD_PACK_OFFER < 卡包价，且每档折算 < 卡包价', () => {
    const totalWeight = Object.values(CARD_DROP_WEIGHT).reduce((a, b) => a + b, 0);
    const expected = (Object.keys(CARD_DUPLICATE_VALUE) as CardStar[]).reduce(
      (sum, s) => sum + (CARD_DROP_WEIGHT[s] / totalWeight) * CARD_DUPLICATE_VALUE[s],
      0,
    );
    expect(expected * CARD_PACK_OFFER).toBeLessThan(CARD_PACK_PRICE);
    for (const s of Object.keys(CARD_DUPLICATE_VALUE) as CardStar[]) {
      expect(CARD_DUPLICATE_VALUE[s], `${s}★ 折算`).toBeLessThan(CARD_PACK_PRICE);
    }
  });
});

describe('clampEffect（数值硬限）', () => {
  it('roll_bonus ±30 钳制、非有限数归 0、四舍五入', () => {
    expect(clampEffect({ kind: 'roll_bonus', amount: 50 })).toEqual({ kind: 'roll_bonus', amount: 30 });
    expect(clampEffect({ kind: 'roll_bonus', amount: -50 })).toEqual({ kind: 'roll_bonus', amount: -30 });
    expect(clampEffect({ kind: 'roll_bonus', amount: Number.NaN })).toEqual({ kind: 'roll_bonus', amount: 0 });
    expect(clampEffect({ kind: 'roll_bonus', amount: 3.6 })).toEqual({ kind: 'roll_bonus', amount: 4 });
  });

  it('demand_mod ±40、crit_window ±5、narrative 截断 40 字', () => {
    expect(clampEffect({ kind: 'demand_mod', amount: 100 })).toEqual({ kind: 'demand_mod', amount: 40 });
    expect(clampEffect({ kind: 'crit_window', success_delta: 10, fail_delta: -10 })).toEqual({
      kind: 'crit_window',
      success_delta: 5,
      fail_delta: -5,
    });
    // 返回的是联合类型，直接 toEqual 整值断言，避免逐属性窄化
    expect(clampEffect({ kind: 'narrative', text: '长'.repeat(50) })).toEqual({
      kind: 'narrative',
      text: '长'.repeat(40),
    });
  });

  it('outcome_convert / reroll 原样透传（无数值可超限）', () => {
    const conv: CardEffect = { kind: 'outcome_convert', from: 'crit_fail', to: 'crit_success' };
    expect(clampEffect(conv)).toBe(conv);
    const rr: CardEffect = { kind: 'reroll', on: 'fail' };
    expect(clampEffect(rr)).toBe(rr);
  });

  it('kind 非法 → null（调用方必须过滤，防脏数据流入校验管线）', () => {
    expect(clampEffect({ kind: 'nope' } as unknown as CardEffect)).toBeNull();
  });
});

describe('validateCard（AI 生成卡硬校验）', () => {
  it('合法卡通过', () => {
    expect(validateCard(mkCard())).toEqual({ ok: true, errors: [] });
  });

  it('字段缺失/枚举非法逐项报错', () => {
    const r = validateCard(mkCard({ id: '', name: '', type: 'sword' as Card['type'] }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('缺少 id');
    expect(r.errors).toContain('缺少名称');
    expect(r.errors.some(e => e.includes('类型非法'))).toBe(true);
  });

  it('效果集为空 / 超过 3 个拒绝', () => {
    expect(validateCard(mkCard({ effects: [] })).errors).toContain('缺少效果');
    expect(
      validateCard(
        mkCard({
          effects: [
            { kind: 'roll_bonus', amount: 1 },
            { kind: 'roll_bonus', amount: 2 },
            { kind: 'roll_bonus', amount: 3 },
            { kind: 'roll_bonus', amount: 4 },
          ],
        }),
      ).errors,
    ).toContain('效果数量超过 3 个');
  });

  it('数值超限拒绝', () => {
    expect(validateCard(mkCard({ effects: [{ kind: 'roll_bonus', amount: 31 }] })).errors).toContain(
      '骰值修正超过 ±30',
    );
  });

  it('恒等转化拒绝；合法转化（crit_fail→crit_success）放行', () => {
    // from/to 枚举交集只有 crit_success，恒等卡点在该组合上触发
    expect(
      validateCard(
        mkCard({ effects: [{ kind: 'outcome_convert', from: 'crit_success', to: 'crit_success' }] }),
      ).errors.some(e => e.includes('无意义')),
    ).toBe(true);
    expect(
      validateCard(mkCard({ effects: [{ kind: 'outcome_convert', from: 'crit_fail', to: 'crit_success' }] })).ok,
    ).toBe(true);
  });

  it('宽触发区间 + 纯利好高星卡拒绝；带代价效果或低星放行', () => {
    const wide = (star: Card['star'], effects: CardEffect[]): Card =>
      mkCard({
        star,
        trigger: { kind: 'demand', typeValue: '', grade: null, min: 0, max: 99, outcome: null },
        effects,
      });
    expect(validateCard(wide('3', [{ kind: 'roll_bonus', amount: 10 }])).errors).toContain(
      '宽触发区间的高星卡必须带代价或负向效果',
    );
    expect(validateCard(wide('3', [{ kind: 'demand_mod', amount: -10 }])).ok).toBe(true);
    expect(validateCard(wide('2', [{ kind: 'roll_bonus', amount: 10 }])).ok).toBe(true);
  });

  it('demand [0,0] 死区间拒绝（max ≥ 1）', () => {
    const r = validateCard(
      mkCard({ trigger: { kind: 'demand', typeValue: '', grade: null, min: 0, max: 0, outcome: null } }),
    );
    expect(r.errors.some(e => e.includes('需求区间非法'))).toBe(true);
  });

  it('叙事超长拒绝', () => {
    expect(validateCard(mkCard({ narrative: '长'.repeat(41) })).errors.some(e => e.includes('叙事超过'))).toBe(true);
  });
});

describe('checkDeckBudget（星级预算）', () => {
  it('3★≤2 / 4★≤1 / 5★≤1；1/2 星不限', () => {
    expect(checkDeckBudget([{ star: '3' }, { star: '3' }]).ok).toBe(true);
    expect(checkDeckBudget([{ star: '3' }, { star: '3' }, { star: '3' }]).errors).toContain('3星卡最多 2 张');
    expect(checkDeckBudget([{ star: '4' }, { star: '4' }]).ok).toBe(false);
    expect(checkDeckBudget([{ star: '5' }, { star: '4' }, { star: '3' }, { star: '3' }]).ok).toBe(true);
    expect(checkDeckBudget(Array.from({ length: 6 }, () => ({ star: '1' as const }))).ok).toBe(true);
  });
});

describe('耐久与修复（v70）', () => {
  it('耐久 = 星级基础 × 类型修正，钳 [10,40]', () => {
    expect(cardMaxDurability({ star: '5', type: 'blessing' })).toBe(40);
    expect(cardMaxDurability({ star: '1', type: 'trial' })).toBe(10);
    expect(cardMaxDurability({ star: '3', type: 'weapon' })).toBe(25);
    expect(cardMaxDurability({ star: '2', type: 'spell' })).toBe(18);
  });

  it('修复成本按星级递增、类型修正后钳 ≥1', () => {
    expect(cardRepairCost({ star: '5', type: 'trial' })).toBe(7);
    expect(cardRepairCost({ star: '1', type: 'blessing' })).toBe(3);
    expect(cardRepairCost({ star: '1', type: 'trial' })).toBe(1);
  });

  it('破损判定：broken 或耐久 ≤0（缺字段视为 0）', () => {
    expect(isCardBroken({ broken: true, durability: 5 })).toBe(true);
    expect(isCardBroken({ durability: 0 })).toBe(true);
    expect(isCardBroken({ durability: 3 })).toBe(false);
    expect(isCardBroken({})).toBe(true);
  });
});

describe('杂项', () => {
  it('isHighStar：3 星及以上为稀有', () => {
    expect(isHighStar('2')).toBe(false);
    expect(isHighStar('3')).toBe(true);
    expect(isHighStar('5')).toBe(true);
  });

  it('sanitizeNarrative 滤连续连字符（防注释提前闭合）', () => {
    expect(sanitizeNarrative('卡--名')).toBe('卡－名');
    expect(sanitizeNarrative('a---b --> c')).toBe('a－b －> c');
    expect(sanitizeNarrative('正常文本')).toBe('正常文本');
  });
});
