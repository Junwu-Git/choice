import { describe, expect, it } from 'vitest';
import { isDiceFormula, mapProxyToRange, rollDiceExpression } from '@/core/dice-expression';

describe('isDiceFormula', () => {
  it('合法骰式识别（含保留/丢弃后缀与算术常量）', () => {
    for (const f of ['2d6', '2d6+3', '4d6kH3', '3d10dl1', '2d6-1d6', '3d6*5+1d4/2', '1d100+50']) {
      expect(isDiceFormula(f), f).toBe(true);
    }
  });

  it('非法输入拒绝：无骰段/残留 k/d/h/l/非法字符/超长', () => {
    for (const f of ['', '1+2', 'd6', '攻击', '2d6k3', '2d6x', '2d6;rm', '1d'.repeat(21)]) {
      expect(isDiceFormula(f), f).toBe(false);
    }
  });

  it('骰段紧邻小数点必拒（compile 产物是属性访问/语法错误，回退 D100 造成徽标与实际不一致）', () => {
    for (const f of ['1.5d6', '2d6.5', '.5d6', '1.5d6.5', '2d6..5']) {
      expect(isDiceFormula(f), f).toBe(false);
    }
  });

  it('合法小数常量不紧贴骰段 → 放行', () => {
    expect(isDiceFormula('2d6*0.5')).toBe(true);
    expect(isDiceFormula('1d100+2.5')).toBe(true);
  });

  it('残留必须语法合法：截断/括号残骸过字符白名单但 compile 必 SyntaxError', () => {
    for (const f of ['2d6+', '(2d6', '2d6)(']) {
      expect(isDiceFormula(f), f).toBe(false);
    }
  });

  it("'--'/'++' 被 JS 词法吃成单个自增/减 token，纯字面量残留恒为语法错误 → 必拒", () => {
    for (const f of ['2d6--3', '2d6++3', '--2d6', '++2d6', '2d6+--3']) {
      expect(isDiceFormula(f), f).toBe(false);
    }
    // 相邻单目符号不构成 token 的读法仍合法
    expect(isDiceFormula('2d6-(-3)')).toBe(true);
    expect(isDiceFormula('2d6+-3')).toBe(true);
  });
});

describe('rollDiceExpression', () => {
  it('值域取所有骰子同取最小/最大：2d6+3 → [5,15]，随机值落在域内', () => {
    const r = rollDiceExpression('2d6+3');
    expect(r).not.toBeNull();
    expect(r!.min).toBe(5);
    expect(r!.max).toBe(15);
    expect(r!.total).toBeGreaterThanOrEqual(5);
    expect(r!.total).toBeLessThanOrEqual(15);
  });

  it('保留最高：4d6kH3 → min 3 / max 18', () => {
    expect(rollDiceExpression('4d6kH3')).toMatchObject({ min: 3, max: 18 });
  });

  it('除零产生 ±Inf/NaN → 整体作废返回 null', () => {
    expect(rollDiceExpression('2d6/0')).toBeNull();
  });

  it('纯算术非本模块职责：可求值，但入口由 isDiceFormula 门控（不含骰段不算骰式）', () => {
    expect(rollDiceExpression('1+2')).toEqual({ total: 3, min: 3, max: 3 });
  });

  it('注入面一律 null，绝不抛错', () => {
    for (const f of ['2d6);alert(1', '2d6+process.exit', '.__proto__.d6', '2d6;rm']) {
      expect(rollDiceExpression(f), f).toBeNull();
    }
  });

  it('骰数/面数钳到 [1,100]/[1,1000]：极端输入仍有值域', () => {
    // 999d9999 → 钳为 100d1000
    const r = rollDiceExpression('999d9999');
    expect(r).not.toBeNull();
    expect(r!.min).toBe(100);
    expect(r!.max).toBe(100000);
  });
});

describe('mapProxyToRange', () => {
  it('0-100 代理按比映射到值域', () => {
    expect(mapProxyToRange(50, 0, 100)).toBe(50);
    expect(mapProxyToRange(50, 10, 20)).toBe(15);
  });

  it('代理越界 clamp [1,100] 后映射', () => {
    expect(mapProxyToRange(150, 0, 100)).toBe(100);
    expect(mapProxyToRange(0, 0, 100)).toBe(1);
  });

  it('退化值域（max ≤ min）与非有限输入返回 min', () => {
    expect(mapProxyToRange(50, 10, 10)).toBe(10);
    expect(mapProxyToRange(Number.NaN, 0, 100)).toBe(0);
  });
});
