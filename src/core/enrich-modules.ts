/**
 * 润色链路的模块补齐（纯函数，可单测）。
 *
 *  为什么需要：enrich_prompt 里写着「详细规则与规格见系统消息」——字数、格式、
 *  忠实度这些规则住在 enrich_core_rules / enrich_output_spec / enrich_thinking 里。
 *  这些模块若缺失，润色请求只剩一句任务指令，输出质量断崖式下降，而用户很难
 *  意识到「我把规则模块删了」。
 */

import type { PromptModule } from '@/type/settings';

/** 润色链路的必需模块 id。
 *
 *  enrich_assistant 在列：它带的是润色链路的**输出契约**（先 <thinking> 自检、
 *  再 <options>），删掉后模型可能直接吐成品或漏掉思考块——与规则模块同级。 */
export const ENRICH_REQUIRED_MODULE_IDS = [
  'enrich_prompt',
  'enrich_core_rules',
  'enrich_output_spec',
  'enrich_thinking',
  'enrich_assistant',
] as const;

/**
 * 补齐「被删掉」的润色模块。
 *
 *  区分两种缺失：
 *  ① 模块从工作副本里被删了 → 用默认内容补回（多半是无意删除）；
 *  ② 模块还在但被停用（enabled=false）→ 尊重用户的选择，不补。
 *  allModules 给出的是全部模块（含停用），据此区分。 */
export function ensureEnrichModules(
  enabledModules: PromptModule[],
  allModules: PromptModule[],
  defaults: PromptModule[],
): PromptModule[] {
  const out = [...enabledModules];
  for (const id of ENRICH_REQUIRED_MODULE_IDS) {
    if (out.some(m => m.id === id)) continue;
    if (allModules.some(m => m.id === id)) continue;
    const fallback = defaults.find(m => m.id === id);
    if (fallback) out.push({ ...fallback });
  }
  return out;
}
