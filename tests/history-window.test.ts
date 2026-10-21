import { describe, expect, it } from 'vitest';
import { calcRegexDepth } from '@/core/history-window';

describe('calcRegexDepth', () => {
  it('最后一条可见消息 depth 为 0', () => {
    expect(calcRegexDepth(10, 9)).toBe(0);
  });

  it('往前逐条加一', () => {
    expect(calcRegexDepth(10, 8)).toBe(1);
    expect(calcRegexDepth(10, 0)).toBe(9);
  });

  it('以全部可见消息数为基准（与酒馆主生成同口径）', () => {
    // 轮数模式只发最后 20 条，但 depth 仍按整段可见聊天算：
    // 否则 minDepth/maxDepth 限定的酒馆正则会在两个链路切在不同楼层
    expect(calcRegexDepth(200, 180)).toBe(19);
  });

  it('越界位置不产生负数', () => {
    expect(calcRegexDepth(3, 5)).toBe(0);
  });
});
