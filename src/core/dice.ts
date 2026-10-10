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
  const high = bounds ? clampInt(critSuccessThreshold, bounds.min, bounds.max) : clampInt(critSuccessThreshold, 2, 100);
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

/** 程度占比断点（v73 起：按 |margin| 占判定空间的比例分档，取代 v58 固定绝对值断点）。
 *  成功侧 p≥0.8 势如破竹 / ≥0.6 漂亮完胜 / ≥0.4 顺利达成 / ≥0.2 险胜 / 其余 勉强得手；
 *  失败侧同断点映射 彻底落败/溃败/事与愿违/功亏一篑/差点成功。
 *  p 的分母是「实际成功（或失败）面数」——同一差值在不同需求值下观感本就不同：
 *  需求 36 时差值 39 占成功空间 60%（漂亮完胜），需求 85 时 39 点已是近满值（势如破竹），
 *  固定绝对值断点把两者都压进同一档，低需求场景的系统性低估正是 v73 要修的。 */
export const DEGREE_P_LOW = 0.2;
export const DEGREE_P_MID = 0.4;
export const DEGREE_P_MID_HIGH = 0.6;
export const DEGREE_P_HIGH = 0.8;

/** 程度档位（成功/失败按 p 分档，彩蛋为单条不落档）。 */
export type DiceDegreeTier = 'low' | 'mid_low' | 'mid' | 'mid_high' | 'high';

/** 程度判定上下文：mode 决定成功空间在值域哪一侧，rate 定位成功/失败区段，
 *  bounds 供骰式路径传表达式值域（缺省按 D100 1..100）。 */
export type DegreeContext = { mode: DiceRollMode; rate: number; bounds?: { min: number; max: number } };

/** 成功/失败面数（含边界：成功面 high=[rate,max]/low=[min,rate]，失败面 high=[min,rate)/low=(rate,max]）。
 *  rate 越界钳进值域，防除零与负空间。 */
export function degreeSpace(
  mode: DiceRollMode,
  rate: number,
  bounds?: { min: number; max: number },
): { success: number; fail: number } {
  const min = bounds?.min ?? 1;
  const max = bounds?.max ?? 100;
  const r = Math.max(min, Math.min(max, Math.round(rate)));
  return mode === 'low' ? { success: r - min + 1, fail: max - r } : { success: max - r + 1, fail: r - min };
}

/** 差值占判定空间的归一化比例（成功侧/失败侧各自空间，clamp [0,1]；空间≤0 兜底 1，实际不会走到） */
function degreeRatio(margin: number, space: number): number {
  if (space <= 0) return 1;
  return Math.max(0, Math.min(1, Math.abs(margin) / space));
}

/** 程度单一入口（v73）：词与档位同源，marginDegree/degreeTierFor 均委托于此。
 *  彩蛋结局固定词/null 档（彩蛋阈值独立于需求，margin 符号可能相反——rate=99 掷 96
 *  是大成功但 margin=−3，不能按 margin 判程度）。 */
export function degreeBucket(
  outcome: DiceOutcome,
  margin: number,
  ctx: DegreeContext,
): { tier: DiceDegreeTier | null; word: string } {
  if (outcome === 'crit_success') return { tier: null, word: '惊艳无比' };
  if (outcome === 'crit_fail') return { tier: null, word: '灾难性失败' };
  const { success, fail } = degreeSpace(ctx.mode, ctx.rate, ctx.bounds);
  const pass = outcome === 'success';
  const p = pass ? degreeRatio(margin, success) : degreeRatio(margin, fail);
  if (p >= DEGREE_P_HIGH) return pass ? { tier: 'high', word: '势如破竹' } : { tier: 'high', word: '彻底落败' };
  if (p >= DEGREE_P_MID_HIGH) return pass ? { tier: 'mid_high', word: '漂亮完胜' } : { tier: 'mid_high', word: '溃败' };
  if (p >= DEGREE_P_MID) return pass ? { tier: 'mid', word: '顺利达成' } : { tier: 'mid', word: '事与愿违' };
  if (p >= DEGREE_P_LOW) return pass ? { tier: 'mid_low', word: '险胜' } : { tier: 'mid_low', word: '功亏一篑' };
  return pass ? { tier: 'low', word: '勉强得手' } : { tier: 'low', word: '差点成功' };
}

/** 程度词（注释头部/摘要共用）：按结局 + margin + 判定上下文给出。
 *  margin=0（恰好达标）→ p=0 → 成功侧最低档「勉强得手」；彩蛋固定词不受影响。 */
export function marginDegree(outcome: DiceOutcome, margin: number, ctx: DegreeContext): string {
  return degreeBucket(outcome, margin, ctx).word;
}

/** 程度档位（buildDiceMarker 取对应档位模板），与 marginDegree 同源、口径一致。 */
export function degreeTierFor(outcome: DiceOutcome, margin: number, ctx: DegreeContext): DiceDegreeTier | null {
  return degreeBucket(outcome, margin, ctx).tier;
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
 *  buildDiceMarker 与 option-action 的 wrapCardNarratives 共用。 */
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
 *  v73：档位改占比制，程度词/档位从 DegreeContext 计算（rate+bounds 决定判定空间）。
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
  /** 判定上下文：mode 决定成功空间方向，bounds 供骰式路径传表达式值域（缺省 D100） */
  ctx: DegreeContext,
  optionTitle?: string,
): string {
  const degreeCtx: DegreeContext = { mode: ctx.mode, rate, bounds: ctx.bounds };
  let tpl: string;
  if (outcome === 'success') {
    const tier = degreeTierFor(outcome, margin, degreeCtx)!;
    tpl = templates.success[tier] || fallback.success[tier];
  } else if (outcome === 'fail') {
    const tier = degreeTierFor(outcome, margin, degreeCtx)!;
    tpl = templates.fail[tier] || fallback.fail[tier];
  } else if (outcome === 'crit_success') {
    tpl = templates.critSuccess || fallback.critSuccess;
  } else {
    tpl = templates.critFail || fallback.critFail;
  }
  if (!tpl.trim()) return '';
  const degree = marginDegree(outcome, margin, degreeCtx);
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
