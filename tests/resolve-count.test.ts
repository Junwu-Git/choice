import { describe, expect, it } from 'vitest';
import { resolveCount } from '@/core/resolve-count';

describe('resolveCount', () => {
  it('固定数量原样返回，不被上限压扁', () => {
    // 回归：曾有 RESOLVE_COUNT_MAX=20 把 50 静默压成 20
    expect(resolveCount('50')).toBe(50);
    expect(resolveCount('70')).toBe(70);
    expect(resolveCount('4')).toBe(4);
  });

  it('区间在 [min,max] 内随机且不压扁', () => {
    // 回归：50-70 配置曾被钳到 20
    for (let i = 0; i < 200; i++) {
      const c = resolveCount('50-70');
      expect(c).toBeGreaterThanOrEqual(50);
      expect(c).toBeLessThanOrEqual(70);
    }
  });

  it('区间 min>max 自动换序', () => {
    for (let i = 0; i < 200; i++) {
      const c = resolveCount('70-50');
      expect(c).toBeGreaterThanOrEqual(50);
      expect(c).toBeLessThanOrEqual(70);
    }
  });

  it('区间下界可为 0 但结果至少 1', () => {
    expect(resolveCount('0-1')).toBeGreaterThanOrEqual(1);
  });

  it('非法输入回退 schema 默认（4），不再产出 0', () => {
    expect(resolveCount('')).toBe(4);
    expect(resolveCount('abc')).toBe(4);
    expect(resolveCount('0')).toBe(4);
    expect(resolveCount('-3')).toBe(4);
  });

  it('空白容错', () => {
    expect(resolveCount('  6  ')).toBe(6);
    expect(resolveCount(' 3 - 8 ')).toBeGreaterThanOrEqual(3);
    expect(resolveCount(' 3 - 8 ')).toBeLessThanOrEqual(8);
  });
});
