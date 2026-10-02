/**
 * 选项骰子判定（v57 共享层）：难度制——AI 标注/档位兜底的数字是「需求值」，
 * 掷出 ≥ 需求才算成功，点数越大越好（与用户直觉、正文 AI 理解一致，v55 的
 * 「掷 ≤ 率 = 成功」概率制已废弃）。v61 起抽象出「判定方向」：
 *   - high（默认，难度制原语义）：点数 ≥ 目标=成功；
 *   - low（COC 百分位）：点数 ≤ 目标=成功。
 * 大成功/大失败彩蛋阈值在两模式下语义相反（high：掷 ≥ 高值=大成功；low：掷 ≤ 低值=大成功），
 * 由调用方按 dice.low_roll 选好阈值组后经 judgeOutcome 判定——本模块不感知 schema 字段名。
 * rollDice 掷 1–100（D100 路径）；骰式表达式路径（NdM，v61，dice.allow_formula）复用
 * judgeOutcome 判定，只是 value/target 落在骰式值域上。buildDiceMarker 按结局渲染隐形
 * 演绎注释（HTML 注释，AI 可见、聊天渲染不可见）。v57 起：成功也注入注释；所有结局模板
 * 均可用 {rate}/{roll}/{margin}/{degree}，margin 由调用方经 diceMargin 归一化（成功侧为正），
 * degree 按口语化程度词（成功侧/失败侧各五档，见 marginDegree）。
 * UI 徽标与判定入口统一走 attribute-dc.ts 的 resolveOptionSuccessRateWithAttr / resolveRateForDisplay
 * 解析需求值（档位兜底在 option-format.gradeFallbackRate，模式感知），本模块只负责随机判定、
 * 程度词与注释渲染，不持有任何 UI/统计依赖。
 */

export type DiceOutcome = 'crit_success' | 'success' | 'fail' | 'crit_fail';
/** 判定结局 → 中文名（注释头部「结局」键的单一来源；cards-meta 的 CARD_OUTCOME_LABEL 从此展开） */
export const DICE_OUTCOME_LABEL: Readonly<Record<DiceOutcome, string>> = {
  crit_success: '大成功',
  success: '成功',
  fail: '失败',
  crit_fail: '大失败',
};
/** 判定方向：high = 点数 ≥ 目标=成功（默认，点数越大越好）；low = 点数 ≤ 目标成功（COC 百分位） */
export type DiceRollMode = 'high' | 'low';

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** 通用成败判定（D100 与骰式路径共用）：按 value 与 target、彩蛋阈值、判定方向给出结局。
 *  判定序固定：彩蛋优先于成败——即便 target=1（high 模式极高需求），value ≥ 大成功阈值仍判大成功。
 *  彩蛋阈值在对应模式下的允许区间内 clamp（high：大成功 [2,100]、大失败 [1,99]；low 反之；
 *  骰式路径经 bounds 传表达式值域、不吃 D100 硬边），
 *  两段彩蛋重叠（low≥high）时双双失效退化为纯成败判定，防非法设置让判定失灵。 */
export function judgeOutcome(
  value: number,
  target: number,
  critSuccessThreshold: number,
  critFailThreshold: number,
  mode: DiceRollMode = 'high',
  /** 彩蛋阈值 clamp 边界：缺省 D100（保留 [2,100]/[1,99] 非对称，防单点阈值把彩蛋做满）；
   *  骰式路径传表达式值域——mapProxyToRange 映射出的阈值只按值域钳，否则如 1d100+50
   *  值域到 150、大成功映射值 146 被 D100 硬钳到 100 会让大成功几乎不可能 */
  bounds?: { min: number; max: number },
): DiceOutcome {
  if (mode === 'low') {
    // COC 百分位：小点数=大成功（掷 ≤ critSuccessThreshold），大点数=大失败（掷 ≥ critFailThreshold）
    const critS = bounds
      ? clampInt(critSuccessThreshold, bounds.min, bounds.max)
      : clampInt(critSuccessThreshold, 1, 99);
    const critF = bounds ? clampInt(critFailThreshold, bounds.min, bounds.max) : clampInt(critFailThreshold, 2, 100);
    const critsActive = critS < critF;
    if (critsActive && value <= critS) return 'crit_success';
    if (critsActive && value >= critF) return 'crit_fail';
    return value <= target ? 'success' : 'fail';
  }
  // high（默认）：大点数=大成功（掷 ≥ critSuccessThreshold），小点数=大失败（掷 ≤ critFailThreshold）
  const low = bounds ? clampInt(critFailThreshold, bounds.min, bounds.max) : clampInt(critFailThreshold, 1, 99);
  const high = bounds
    ? clampInt(critSuccessThreshold, bounds.min, bounds.max)
    : clampInt(critSuccessThreshold, 2, 100);
  const critsActive = low < high;
  if (critsActive && value >= high) return 'crit_success';
  if (critsActive && value <= low) return 'crit_fail';
  return value >= target ? 'success' : 'fail';
}

/** 掷 D100（1–100）并按阈值判定（难度制）。critSuccessMin/critFailMax 是 high 模式下的
 *  大成功下限/大失败上限（默认 96/5）；low 模式调用方应传对应阈值组（见 option-action.ts）。
 *  返回的 roll 与 outcome 供 chip/marker/统计消费。 */
export function rollDice(
  rate: number,
  critSuccessMin: number,
  critFailMax: number,
  mode: DiceRollMode = 'high',
): { roll: number; outcome: DiceOutcome } {
  const roll = Math.floor(Math.random() * 100) + 1;
  return { roll, outcome: judgeOutcome(roll, rate, critSuccessMin, critFailMax, mode) };
}

/** 归一化判定差值（成功侧恒为正、失败侧恒为负，供 chip 与 marker 共用同一口径）：
 *  high = roll − rate（点数越大差距越大）；low = rate − roll（点数越小差距越大）。
 *  margin=0 表示恰好达标。 */
export function diceMargin(mode: DiceRollMode, roll: number, rate: number): number {
  return mode === 'low' ? rate - roll : roll - rate;
}

/** 程度词断点（固定常量，D100 下 margin ≈ −99…+99 按五等分对称；如需可配置
 *  再上移 schema——勿在两处各写一份）。成功侧 [0,20) 勉强得手 / [20,40) 险胜 /
 *  [40,60) 顺利达成 / [60,80) 漂亮完胜 / [≥80) 势如破竹；失败侧 (−20,0] 差点成功 /
 *  (−40,−20] 功亏一篑 / (−60,−40] 事与愿违 / (−80,−60] 溃败 / [≤−80] 彻底落败。 */
export const DEGREE_SUCCESS_HIGH = 80;
export const DEGREE_SUCCESS_MID_HIGH = 60;
export const DEGREE_SUCCESS_MID = 40;
export const DEGREE_SUCCESS_LOW = 20;
export const DEGREE_FAIL_LOW = -80;
export const DEGREE_FAIL_MID_LOW = -60;
export const DEGREE_FAIL_MID = -40;
export const DEGREE_FAIL_HIGH = -20;

/** 按「点数 − 需求」差值给出程度词（纯函数，注释与组件 chip 共用同一口径）。
 *  margin ≥ 0 归成功侧、< 0 归失败侧；margin=0（恰好达标）归「勉强得手」。
 *  彩蛋结局与 margin 符号可能相反（96/5 绝对彩蛋带独立于需求，如 rate=99 掷 96
 *  → 大成功但 margin=−3），必须按结局固定程度词，否则注入文案会「大成功…差点成功」自相矛盾 */
export function marginDegree(outcome: DiceOutcome, margin: number): string {
  if (outcome === 'crit_success') return '惊艳无比';
  if (outcome === 'crit_fail') return '灾难性失败';
  if (margin >= DEGREE_SUCCESS_HIGH) return '势如破竹';
  if (margin >= DEGREE_SUCCESS_MID_HIGH) return '漂亮完胜';
  if (margin >= DEGREE_SUCCESS_MID) return '顺利达成';
  if (margin >= DEGREE_SUCCESS_LOW) return '险胜';
  if (margin >= 0) return '勉强得手';
  if (margin > DEGREE_FAIL_HIGH) return '差点成功';
  if (margin > DEGREE_FAIL_MID) return '功亏一篑';
  if (margin > DEGREE_FAIL_MID_LOW) return '事与愿违';
  if (margin > DEGREE_FAIL_LOW) return '溃败';
  return '彻底落败';
}

/** 程度档位（成功/失败按 margin 分段，彩蛋为单条不落档）。
 *  success：low [0,20) 勉强得手 / mid_low [20,40) 险胜 / mid [40,60) 顺利达成 /
 *  mid_high [60,80) 漂亮完胜 / high [≥80) 势如破竹；
 *  fail：low (−20,0] 差点成功 / mid_low (−40,−20] 功亏一篑 / mid (−60,−40] 事与愿违 /
 *  mid_high (−80,−60] 溃败 / high [≤−80] 彻底落败。 */
export type DiceDegreeTier = 'low' | 'mid_low' | 'mid' | 'mid_high' | 'high';

/** 按结局 + margin 选择程度档位；彩蛋结局返回 null（单条模板，不走分档）。
 *  供 buildDiceMarker 取对应档位模板，与 marginDegree 共用断点常量、口径一致。 */
export function degreeTierFor(outcome: DiceOutcome, margin: number): DiceDegreeTier | null {
  if (outcome === 'crit_success' || outcome === 'crit_fail') return null;
  if (outcome === 'success') {
    if (margin >= DEGREE_SUCCESS_HIGH) return 'high';
    if (margin >= DEGREE_SUCCESS_MID_HIGH) return 'mid_high';
    if (margin >= DEGREE_SUCCESS_MID) return 'mid';
    if (margin >= DEGREE_SUCCESS_LOW) return 'mid_low';
    return 'low';
  }
  if (margin <= DEGREE_FAIL_LOW) return 'high';
  if (margin <= DEGREE_FAIL_MID_LOW) return 'mid_high';
  if (margin <= DEGREE_FAIL_MID) return 'mid';
  if (margin <= DEGREE_FAIL_HIGH) return 'mid_low';
  return 'low';
}

export type DiceTemplates = {
  /** 成功侧五档独立演绎指令（v58：按 margin 命中取对应档，空 = 该档回退 fallback） */
  success: { low: string; mid_low: string; mid: string; mid_high: string; high: string };
  /** 失败侧五档独立演绎指令（v58） */
  fail: { low: string; mid_low: string; mid: string; mid_high: string; high: string };
  critSuccess: string;
  critFail: string;
};

/** 注释纪律尾注（v67 固定常量，非用户模板）：正文 AI 侧的两条硬纪律——防把判定数值
 *  写进正文破坏沉浸、防从历史 few-shot 学会模仿注释格式后在叙述里输出自己的注释。
 *  buildDiceMarker 与 option-action 的纯卡叙事 wrapCardNarratives 共用。 */
export const DICE_MARKER_TAIL =
  '纪律：本回合正文中不得提及骰子、点数、需求值或「判定」字样；不得模仿或输出任何 HTML 注释。';

/** 渲染隐形演绎注释：HTML 注释包住模板文本，AI 读得到、酒馆聊天渲染不可见。
 *  模板优先取 send 版，为空回退 fallback 版；fallback 也为空则整体返回空串
 *  （不附加注释）。占位符 {rate}/{roll}/{margin}/{degree} 所有模板通用（v57 起
 *  成功也注入；margin = 判定差值，默认 high 口径 roll − rate，调用方可传 diceMargin
 *  （v61 判定方向）归一化的 margin 以保证低点数模式成功侧为正；degree = marginDegree
 *  程度词，模板可选用）。
 *  v58：成功/失败按 degreeTierFor 命中档位取对应 send 模板；彩蛋取单条。
 *  v67：注释改三段结构——代码固定拼结构化头部（键值前置比散文数字对弱模型更可靠）
 *  + 模板正文（默认即纯演绎指令，数字由头部承载）+ 固定纪律尾注。模板内如出现 `-->`
 *  会提前截断注释（HTML 语法），整段内容统一过 `-{2,}` 清洗硬保证。
 *  头部键：结局（显式给出成败，弱模型不必从程度词反推）｜裁定对象（选项标题回显，
 *  消歧「注释修饰的是哪个行动」；解析不出则省略）｜点数｜需求｜差值｜程度。 */
export function buildDiceMarker(
  outcome: DiceOutcome,
  roll: number,
  rate: number,
  templates: DiceTemplates,
  fallback: DiceTemplates,
  /** 必传：调用方传 diceMargin 归一化差值（成功侧为正）——默认值曾隐含 high 口径，
   *  low 模式忘传会反号，故取消默认 */
  margin: number,
  /** 选项标题回显（parseOptionType 解析，超长由调用方截断），空则省略「裁定对象」键 */
  optionTitle?: string,
): string {
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
  const degree = marginDegree(outcome, margin);
  const titleSeg = optionTitle ? `｜裁定对象 ${optionTitle}` : '';
  const header = `【骰子裁定·系统注入，玩家不可见】结局 ${DICE_OUTCOME_LABEL[outcome]}${titleSeg}｜点数 ${roll}｜需求 ${rate}｜差值 ${margin > 0 ? '+' : ''}${margin}｜程度 ${degree}`;
  const body = tpl
    .replace(/\{rate\}/g, String(rate))
    .replace(/\{roll\}/g, String(roll))
    .replace(/\{margin\}/g, String(margin))
    .replace(/\{degree\}/g, degree);
  // 头部/模板/尾注合并后统一清洗：任一段出现连续连字符都会提前闭合 HTML 注释泄漏正文
  // （设置页 hint 只是软约束，此处硬保证）
  const content = `${header}\n${body}\n${DICE_MARKER_TAIL}`.replace(/-{2,}/g, '－');
  return `<!--${content}-->\n`;
}
