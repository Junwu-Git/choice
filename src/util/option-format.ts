/**
 * 选项文本解析（共享层）：主面板 ActionOptionsPanel 与悬浮球弹窗 FloatingOptions
 * 共用同一份解析规则——分隔符/方括号标头/拆类型与内容的口径必须在两处保持一致，
 * 单边改动会造成同一选项在两组 UI 中显示不同。不要在两处各写一份。
 *
 * v54 起支持 AI 输出侧的风险档位标注：标题内竖线标注（[标题|大胆]），
 * parseOptionType/parseOptionStyle 共享同一拆分口径；`|` 后第二段命中
 * 受控词表才按档位拆，词表外整体当标题（防御自定义 type 含 `|` 的条目被误拆）。
 *
 * v55 起支持成功率标注：档位后追加整数百分比段（[标题|大胆|70%]），
 * parseOptionRate/parseOptionStyle/parseOptionType 共享同一拆分口径。兼容规则：
 * 任一段既不是受控档位词、也不是成功率数字时整段回退当标题（宁可不拆不错拆，
 * 防自定义 type 含竖线被误拆——与 v54 词表外防御同一哲学）。
 *
 * v56 起数字语义为「需求值」（难度制）：掷出 ≥ 需求值才算成功，点数越大越好、
 * 行动越难标得越高。解析口径不变（仍容忍 0-100 整数、可带可不带 %），
 * 仅含义从「成功概率」改为「达成所需的骰子点数下限」。
 */

import { isDiceFormula } from '@/core/dice-expression';

// 分隔符：半角/全角冒号 + 任意空白（含零个）。generator 端 parseOptions 的 titleRe 是
// `[:：]\s*`（容忍零空格），此处必须同口径——否则「动手:内容」生成端能拆、展示端拆不开，
// 类型前缀与正文重复进输入框。零宽容忍对「12:30」这类串的误切两端一致，域内可接受
const OPTION_SEP_RE = /[:：]\s*/;

// 匹配开头的 [标题] 或 【标题】 模式，标题为括号内文字，括号后紧跟内容
const OPTION_TYPE_BRACKET_RE = /^[[【]([^\]】]+)[\]】]\s*/;

// 需求值段受控形态：可选「成功率」前缀 + 1-3 位整数 + 可选 %（容忍 AI 沿旧习惯输出
// 「成功率 70%」「70」等变体，v56 起含义为需求值）。取数值后 clamp [0,100]——AI 输出
// 150% 视为 100。
const RATE_SEGMENT_RE = /^(?:成功率)?\s*(\d{1,3})\s*%?$/i;

const findOptionSep = (text: string): { idx: number; len: number } | null => {
  const m = text.match(OPTION_SEP_RE);
  return m ? { idx: m.index!, len: m[0].length } : null;
};

/** 风险档位分级枚举：与 theme.css 的 --choice-risk-* 别名、ActionOptionsPanel/
 *  FloatingOptions 的样式类一一对应，组件内不得另写一套分级名 */
export type OptionStyleGrade = 'conservative' | 'balanced' | 'bold';

/** 受控档位词表 → 枚举。与 choice-prompts-optimized.json core_rules 输出格式里的
 *  三档（保守/平衡/大胆）字面一致，两处同步改；词表外一律不算档位 */
const STYLE_GRADE_WORDS: Readonly<Record<string, OptionStyleGrade>> = {
  保守: 'conservative',
  平衡: 'balanced',
  大胆: 'bold',
};

const parseRateSegment = (segment: string): number | null => {
  if (segment === '') return null;
  const m = segment.match(RATE_SEGMENT_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};

/** 标题内竖线分段拆分（标题 | 档位 | 成功率 | 骰式），最多拆若干竖线段。
 *  兼容规则：任一段既不是受控档位词、也不是成功率数字、也不是合法骰式 → 整段回退，
 *  title 保留去引号原文（含竖线），style/rate 均 null——与 v54「词表外整体当标题」一致，
 *  防止把自定义 type 里的竖线误拆成标注。档位/成功率/骰式允许顺序互换（各认首个）。
 *  骰式段（v61，`isDiceFormula` 如 `2d6+3`）识别为有效段并从标题剥离（供允 AI 标注真实
 *  骰式时选项标题保持干净，如 `[攻击|2d6+3|70]` → title 只留「攻击」）。
 *  竖线两侧做 trim、段落去引号（容忍 AI 输出 "[顺势而为 | 大胆 | 70%]"）。 */
const splitBracketParts = (
  rawTitle: string,
): { title: string; style: OptionStyleGrade | null; rate: number | null; formula: string | null } => {
  if (!rawTitle.includes('|')) return { title: rawTitle, style: null, rate: null, formula: null };
  const parts = rawTitle.split('|');
  const head = parts[0].trim(); // 注释承诺「竖线两侧做 trim」：head 侧不能漏（[顺势而为 | 大胆]）
  let style: OptionStyleGrade | null = null;
  let rate: number | null = null;
  let formula: string | null = null;
  let unrecognized = false;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].trim().replace(/"/g, '');
    if (seg === '') {
      unrecognized = true;
      break;
    }
    const grade = STYLE_GRADE_WORDS[seg];
    if (grade) {
      // 已在档位段之后再出现档位词 → 双重标注，视为未识别整体回退
      if (style !== null) {
        unrecognized = true;
        break;
      }
      style = grade;
      continue;
    }
    const parsedRate = parseRateSegment(seg);
    if (parsedRate !== null) {
      if (rate !== null) {
        unrecognized = true;
        break;
      }
      rate = parsedRate;
      continue;
    }
    if (isDiceFormula(seg)) {
      if (formula !== null) {
        unrecognized = true;
        break;
      }
      formula = seg;
      continue;
    }
    unrecognized = true;
    break;
  }
  if (unrecognized) return { title: rawTitle, style: null, rate: null, formula: null };
  return { title: head, style, rate, formula };
};

/** 档位 → 兜底需求值（AI 未标注时按风险档位推导，供骰子判定。难度制：数字 = 达成
 *  所需的骰子点数下限——保守=低需求易成、大胆=高需求难成，与 v55 的「成功率」含义
 *  相反）。兜底值本期固定，仅供 resolveOptionSuccessRate 消费；如需可配置再上移
 *  schema（勿在两处各写一份） */
export const GRADE_FALLBACK_RATE: Readonly<Record<OptionStyleGrade, number>> = {
  conservative: 35,
  balanced: 60,
  bold: 85,
};

/** low（COC）模式的档位兜底：100−v 对偶。high 保守 35 → 成功率 ≈65%；low 对偶 65 →
 *  P(≤65)=65%，两模式成功率一致。语义上 COC 第三段是「能力值」：保守行动所需能力低
 *  （容易 ≤）、大胆所需能力高，数值直觉与难度制相反。 */
export const GRADE_FALLBACK_RATE_LOW: Readonly<Record<OptionStyleGrade, number>> = {
  conservative: 65,
  balanced: 40,
  bold: 15,
};

/** 模式感知的档位兜底唯一入口（v67）：徽标展示与骰子判定共用，勿在调用点各写一份对偶。 */
export const gradeFallbackRate = (style: OptionStyleGrade, lowRoll: boolean): number =>
  lowRoll ? GRADE_FALLBACK_RATE_LOW[style] : GRADE_FALLBACK_RATE[style];

export const parseOptionType = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return splitBracketParts(m[1].replace(/"/g, '')).title;
  const sep = findOptionSep(text);
  return sep ? text.slice(0, sep.idx).replace(/"/g, '') : text.replace(/"/g, '');
};

/** 档位分级解析：只处理 [标题] 括号形态（冒号分隔/无括号形态不参与档位标注）。
 *  无标注 / 词表外 / 老选项 → null，前端按中性样式渲染 */
export const parseOptionStyle = (text: string): OptionStyleGrade | null => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (!m) return null;
  return splitBracketParts(m[1].replace(/"/g, '')).style;
};

/** 需求值解析：只处理 [标题] 括号形态。AI 标注段 → [0,100] 整数；
 *  无标注 / 格式不合法 → null（不做档位兜底，兜底见 resolveOptionSuccessRate）。 */
export const parseOptionRate = (text: string): number | null => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (!m) return null;
  return splitBracketParts(m[1].replace(/"/g, '')).rate;
};

/** 骰式标注解析（v61，dice.allow_formula）：标题内竖线段含合法骰式（如 `2d6+3`）时，
 *  返回 {formula, rate} —— rate 为 0-100 难度代理（显式需求值段或档位兜底，需有其一）。
 *  lowRoll（v67）：档位兜底改走模式感知对偶（COC 下 65/40/15），与判定/徽标同口径。
 *  无骰式段 / 无难度代理 / 段非法 → 返回 null（调用方回退既有解析路径，不改默认行为）。 */
export const parseOptionDice = (text: string, lowRoll = false): { formula: string; rate: number } | null => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (!m) return null;
  const parts = m[1].replace(/"/g, '').split('|');
  let formula: string | null = null;
  let rate: number | null = null;
  let grade: OptionStyleGrade | null = null;
  let bad = false;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].replace(/"/g, '').trim();
    if (seg === '') {
      bad = true;
      break;
    }
    if (isDiceFormula(seg)) {
      if (formula) {
        bad = true;
        break;
      }
      formula = seg;
      continue;
    }
    const gradeV = STYLE_GRADE_WORDS[seg];
    if (gradeV) {
      if (grade) {
        bad = true;
        break;
      }
      grade = gradeV;
      continue;
    }
    const parsedRate = parseRateSegment(seg);
    if (parsedRate !== null) {
      if (rate !== null) {
        bad = true;
        break;
      }
      rate = parsedRate;
      continue;
    }
    bad = true;
    break;
  }
  if (bad || !formula) return null;
  // 难度代理：显式需求值优先，否则档位兜底（模式感知）；都没有就不当作骰式判定（返回 null）
  const proxy = rate !== null ? rate : grade ? gradeFallbackRate(grade, lowRoll) : null;
  return proxy === null ? null : { formula, rate: proxy };
};

export const parseOptionContent = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return text.slice(m[0].length);
  const sep = findOptionSep(text);
  return sep ? text.slice(sep.idx + sep.len) : text;
};
