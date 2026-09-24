/**
 * 选项骰子判定（v57 共享层）：难度制——AI 标注/档位兜底的数字是「需求值」，
 * 掷出 ≥ 需求才算成功，点数越大越好（与用户直觉、正文 AI 理解一致，v55 的
 * 「掷 ≤ 率 = 成功」概率制已废弃）。rollDice 掷 1–100 判定成败，
 * buildDiceMarker 按结局渲染隐形演绎注释（HTML 注释，AI 可见、聊天渲染不可见）。
 * v57 起：成功也注入注释；所有结局模板均可用 {rate}/{roll}/{margin}/{degree}，
 * margin = 点数 − 需求，degree 按口语化程度词（成功侧/失败侧各三档，见 marginDegree）。
 * UI 徽标与判定入口统一走 option-format.ts 的 resolveOptionSuccessRate 解析需求值
 * （档位兜底也在解析层），本模块只负责随机判定、程度词与注释渲染，不持有任何 UI/统计依赖。
 */

export type DiceOutcome = 'crit_success' | 'success' | 'fail' | 'crit_fail';

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** 掷 D100（1–100）并按阈值判定（难度制）。判定序固定：彩蛋优先于成败——即便
 *  rate=1（极高需求），roll ≥ critSuccessMin 仍判大成功；critFailMax ≥
 *  critSuccessMin 时两段彩蛋重叠，双双失效退化为纯成败判定。阈值各自 clamp 到
 *  [1,99]/[2,100]，防非法设置让判定失灵 */
export function rollDice(
  rate: number,
  critSuccessMin: number,
  critFailMax: number,
): { roll: number; outcome: DiceOutcome } {
  const roll = Math.floor(Math.random() * 100) + 1;
  const low = clampInt(critFailMax, 1, 99);
  const high = clampInt(critSuccessMin, 2, 100);
  const critsActive = low < high;
  const outcome: DiceOutcome =
    critsActive && roll >= high
      ? 'crit_success'
      : critsActive && roll <= low
        ? 'crit_fail'
        : roll >= rate
          ? 'success'
          : 'fail';
  return { roll, outcome };
}

/** 程度词断点（v57 固定常量，D100 下 margin ≈ −99…+99 按三等分对称；如需可配置
 *  再上移 schema——勿在两处各写一份）。成功侧 [0,+33) 勉强得手 / [+33,+66) 顺利达成 /
 *  [≥+66) 漂亮完胜；失败侧 (−33,0] 差点成功 / (−66,−33] 事与愿违 / [≤−66] 彻底落败。 */
export const DEGREE_SUCCESS_HIGH = 66;
export const DEGREE_SUCCESS_LOW = 33;
export const DEGREE_FAIL_HIGH = -33;
export const DEGREE_FAIL_LOW = -66;

/** 按「点数 − 需求」差值给出程度词（纯函数，注释与组件 chip 共用同一口径）。
 *  margin ≥ 0 归成功侧、< 0 归失败侧；margin=0（恰好达标）归「勉强得手」。
 *  彩蛋结局与 margin 符号可能相反（96/5 绝对彩蛋带独立于需求，如 rate=99 掷 96
 *  → 大成功但 margin=−3），必须按结局固定程度词，否则注入文案会「大成功…差点成功」自相矛盾 */
export function marginDegree(outcome: DiceOutcome, margin: number): string {
  if (outcome === 'crit_success') return '惊艳无比';
  if (outcome === 'crit_fail') return '灾难性失败';
  if (margin >= DEGREE_SUCCESS_HIGH) return '漂亮完胜';
  if (margin >= DEGREE_SUCCESS_LOW) return '顺利达成';
  if (margin >= 0) return '勉强得手';
  if (margin > DEGREE_FAIL_HIGH) return '差点成功';
  if (margin > DEGREE_FAIL_LOW) return '事与愿违';
  return '彻底落败';
}

/** 程度档位（成功/失败按 margin 分段，彩蛋为单条不落档）。
 *  success：low [0,+33) 勉强得手 / mid [+33,+66) 顺利达成 / high [≥+66) 漂亮完胜；
 *  fail：low (−33,0] 差点成功 / mid (−66,−33] 事与愿违 / high [≤−66] 彻底落败。 */
export type DiceDegreeTier = 'low' | 'mid' | 'high';

/** 按结局 + margin 选择程度档位；彩蛋结局返回 null（单条模板，不走分档）。
 *  供 buildDiceMarker 取对应档位模板，与 marginDegree 共用断点常量、口径一致。 */
export function degreeTierFor(outcome: DiceOutcome, margin: number): DiceDegreeTier | null {
  if (outcome === 'crit_success' || outcome === 'crit_fail') return null;
  if (outcome === 'success') {
    if (margin >= DEGREE_SUCCESS_HIGH) return 'high';
    if (margin >= DEGREE_SUCCESS_LOW) return 'mid';
    return 'low';
  }
  if (margin <= DEGREE_FAIL_LOW) return 'high';
  if (margin <= DEGREE_FAIL_HIGH) return 'mid';
  return 'low';
}

export type DiceTemplates = {
  /** 成功侧三档独立演绎指令（v58：按 margin 命中取对应档，空 = 该档回退 fallback） */
  success: { low: string; mid: string; high: string };
  /** 失败侧三档独立演绎指令（v58） */
  fail: { low: string; mid: string; high: string };
  critSuccess: string;
  critFail: string;
};

/** 渲染隐形演绎注释：HTML 注释包住模板文本，AI 读得到、酒馆聊天渲染不可见。
 *  模板优先取 send 版，为空回退 fallback 版；fallback 也为空则整体返回空串
 *  （不附加注释）。占位符 {rate}/{roll}/{margin}/{degree} 所有模板通用（v57 起
 *  成功也注入；margin = roll − rate，degree = marginDegree 程度词，模板可选用）。
 *  v58：成功/失败按 degreeTierFor 命中档位取对应 send 模板；彩蛋取单条。
 *  模板内如出现 `-->` 会提前截断注释（HTML 语法），设置页 hint 已提示避免输入 `--`。 */
export function buildDiceMarker(
  outcome: DiceOutcome,
  roll: number,
  rate: number,
  templates: DiceTemplates,
  fallback: DiceTemplates,
): string {
  const margin = roll - rate;
  let tpl: string;
  if (outcome === 'success') {
    const tier = degreeTierFor(outcome, margin)!;
    tpl = templates.success[tier] || fallback.success[tier];
  } else if (outcome === 'fail') {
    const tier = degreeTierFor(outcome, margin)!;
    tpl = templates.fail[tier] || fallback.fail[tier];
  } else if (outcome === 'crit_success') {
    tpl = templates.critSuccess || fallback.critSuccess;
  } else {
    tpl = templates.critFail || fallback.critFail;
  }
  if (!tpl.trim()) return '';
  const body = tpl
    .replace(/\{rate\}/g, String(rate))
    .replace(/\{roll\}/g, String(roll))
    .replace(/\{margin\}/g, String(margin))
    .replace(/\{degree\}/g, marginDegree(outcome, margin));
  return `<!--${body}-->\n`;
}
