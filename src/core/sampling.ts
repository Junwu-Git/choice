/**
 * 选项/润色生成的采样下限（纯函数，可单测）。
 *
 *  为什么需要下限：预设模式的采样参数跟随酒馆 CC 预设，而预设为「正文续写」设计，
 *  max_tokens 往往只有几百。选项生成一轮要写 count 条、每条 maxChars 字，
 *  直接沿用预设值会把 <options> 截在半截——解析不出任何选项，用户只看到「生成失败」。
 *
 *  这里只抬 max_tokens，不动 temperature：高温破坏 JSON 的责任在用户选预设，
 *  插件不替他改采样风格（提示由 UI 说明）。
 */

import type { SamplingOverride } from '@/core/api-client';

/** 一轮输出的 token 下限估算：条数 ×（每条字数 + 结构开销）+ 固定余量。 */
export function resolveSamplingFloor(count: number, maxChars: number): number {
  const n = Math.max(1, Math.floor(count) || 1);
  const chars = Math.max(1, Math.floor(maxChars) || 1);
  return Math.max(512, n * (chars + 16) + 256);
}

/** 给预设采样套上输出下限。
 *
 *  extra：合并模式要为 <knowledge_patch> 额外预留的 token（补丁块本身也要写出来）。 */
export function applySamplingFloor(
  sampling: SamplingOverride | undefined,
  count: number,
  maxChars: number,
  extra = 0,
): SamplingOverride | undefined {
  // 0 也算「预设给了值」：连接层用 `??` 取值，0 会被原样发出去（输出上限 0 → 生成结果为空，
  // 用户只看到「未能解析出任何选项」）。所以 0 要被抬到下限，而不是当缺省放行。
  if (!sampling || sampling.max_tokens === undefined || sampling.max_tokens === null) return sampling;
  const floor = resolveSamplingFloor(count, maxChars) + extra;
  const base = Math.max(0, Math.floor(Number(sampling.max_tokens) || 0));
  // 合并模式：补丁块跟在预设值之上（原行为是预设值 + extra），取两者较大
  const maxTokens = Math.max(base + extra, floor);
  if (maxTokens === base) return sampling;
  return { ...sampling, max_tokens: maxTokens };
}
