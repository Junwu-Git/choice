import { describe, expect, it } from 'vitest';
import { applySamplingFloor, resolveSamplingFloor } from '@/core/sampling';

describe('resolveSamplingFloor', () => {
  it('按条数与每条字数估算输出下限', () => {
    expect(resolveSamplingFloor(4, 60)).toBe(4 * 76 + 256);
  });

  it('至少给到 512（极小批量也别卡在几百 token）', () => {
    expect(resolveSamplingFloor(1, 10)).toBe(512);
  });
});

describe('applySamplingFloor', () => {
  it('预设 max_tokens 偏小时抬到下限（否则 <options> 被截在半截）', () => {
    const out = applySamplingFloor({ max_tokens: 200, temperature: 1 }, 10, 200);
    expect(out!.max_tokens).toBe(resolveSamplingFloor(10, 200));
    // 只动 max_tokens，不动 temperature
    expect(out!.temperature).toBe(1);
  });

  it('预设值已经够大时不动', () => {
    const out = applySamplingFloor({ max_tokens: 8000 }, 4, 60);
    expect(out!.max_tokens).toBe(8000);
  });

  it('合并模式额外为补丁块预留 token', () => {
    const out = applySamplingFloor({ max_tokens: 200 }, 4, 60, 800);
    expect(out!.max_tokens).toBe(Math.max(200 + 800, resolveSamplingFloor(4, 60) + 800));
  });

  it('没有 max_tokens 时不臆造（让上游用自己的默认值）', () => {
    expect(applySamplingFloor(undefined, 4, 60)).toBeUndefined();
    expect(applySamplingFloor({ temperature: 0.8 }, 4, 60)).toEqual({ temperature: 0.8 });
  });
});
