/**
 * 选项成功率骰子判定（v55 共享层）：rollDice 掷 1–100 判定成败，
 * buildDiceMarker 按结局渲染隐形演绎注释（HTML 注释，AI 可见、聊天渲染不可见）。
 * UI 徽标与判定入口统一走 option-format.ts 的 resolveOptionSuccessRate 解析成功率
 * （档位兜底也在解析层），本模块只负责随机判定与注释渲染，不持有任何 UI/统计依赖。
 */

export type DiceOutcome = 'crit_success' | 'success' | 'fail' | 'crit_fail';

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** 掷 D100（1–100）并按阈值判定。判定序固定：彩蛋优先于成败——即便 rate=100，
 *  roll ≥ critFailMin 仍判大失败（赌徒契约：天然 1 永远失败）；critSuccessMax ≥
 *  critFailMin 时两段彩蛋重叠，双双失效退化为纯成败判定。阈值各自 clamp 到
 *  [1,99]/[2,100]，防非法设置让判定失灵 */
export function rollDice(
  rate: number,
  critSuccessMax: number,
  critFailMin: number,
): { roll: number; outcome: DiceOutcome } {
  const roll = Math.floor(Math.random() * 100) + 1;
  const low = clampInt(critSuccessMax, 1, 99);
  const high = clampInt(critFailMin, 2, 100);
  const critsActive = low < high;
  const outcome: DiceOutcome = critsActive && roll <= low ? 'crit_success'
    : critsActive && roll >= high ? 'crit_fail'
    : roll <= rate ? 'success'
    : 'fail';
  return { roll, outcome };
}

export type DiceTemplates = {
  fail: string;
  critSuccess: string;
  critFail: string;
};

/** 渲染隐形演绎注释：HTML 注释包住模板文本，AI 读得到、酒馆聊天渲染不可见。
 *  模板优先取 send 版，为空回退 fallback 版——保证判定必有反馈、永不产生空注释；
 *  fallback 也为空则整体返回空串（不附加注释，判定只播报+记战绩）。
 *  成功结局恒返回空串（成功不加注释，AI 正常演绎）。占位符 {rate}/{roll} 两类模板都支持。
 *  模板内如出现 `-->` 会提前截断注释（HTML 语法），设置页 hint 已提示避免输入 `--`。 */
export function buildDiceMarker(
  outcome: DiceOutcome,
  roll: number,
  rate: number,
  templates: DiceTemplates,
  fallback: DiceTemplates,
): string {
  if (outcome === 'success') return '';
  const tpl = outcome === 'fail'
    ? templates.fail || fallback.fail
    : outcome === 'crit_success'
      ? templates.critSuccess || fallback.critSuccess
      : templates.critFail || fallback.critFail;
  if (!tpl.trim()) return '';
  const body = tpl.replace(/\{rate\}/g, String(rate)).replace(/\{roll\}/g, String(roll));
  return `<!--${body}-->\n`;
}
