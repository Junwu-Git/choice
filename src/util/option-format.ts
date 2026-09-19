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
 */

// 分隔符：半角/全角冒号后跟任意空白字符，与 generator.ts 的 parseOptions 正则保持一致
const OPTION_SEP_RE = /[:：]\s/;

// 匹配开头的 [标题] 或 【标题】 模式，标题为括号内文字，括号后紧跟内容
const OPTION_TYPE_BRACKET_RE = /^[[【]([^\]】]+)[\]】]\s*/;

// 成功率段受控形态：可选「成功率」前缀 + 1-3 位整数 + 可选 %（容忍 AI 输出
// 「成功率 70%」「70」等变体）。取数值后 clamp [0,100]——AI 输出 150% 视为 100。
// 不接受小数/区间/自由文本（解析失败按无标注回退，宁缺勿错）
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

/** 标题内竖线分段拆分（标题 | 档位 | 成功率），最多拆两段竖线。
 *  兼容规则：任一段既非受控档位词、又非成功率数字 → 整段回退，title 保留
 *  去引号原文（含竖线），style/rate 均 null——与 v54「词表外整体当标题」一致，
 *  防止把自定义 type 里的竖线误拆成标注。档位/成功率允许顺序互换（各认首个）。
 *  竖线两侧做 trim、段落去引号（容忍 AI 输出 "[顺势而为 | 大胆 | 70%]"）。 */
const splitBracketParts = (
  rawTitle: string,
): { title: string; style: OptionStyleGrade | null; rate: number | null } => {
  if (!rawTitle.includes('|')) return { title: rawTitle, style: null, rate: null };
  const parts = rawTitle.split('|');
  const [head] = parts;
  let style: OptionStyleGrade | null = null;
  let rate: number | null = null;
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
    unrecognized = true;
    break;
  }
  if (unrecognized) return { title: rawTitle, style: null, rate: null };
  return { title: head, style, rate };
};

/** 档位 → 兜底成功率（AI 未标注时按风险档位推导，供骰子判定）。兜底值本期固定，
 *  仅供 resolveOptionSuccessRate 消费；如需可配置再上移 schema（勿在两处各写一份） */
export const GRADE_FALLBACK_RATE: Readonly<Record<OptionStyleGrade, number>> = {
  conservative: 85,
  balanced: 60,
  bold: 35,
};

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

/** 成功率解析：只处理 [标题] 括号形态。AI 标注段 → [0,100] 整数；
 *  无标注 / 格式不合法 → null（不做档位兜底，兜底见 resolveOptionSuccessRate）。 */
export const parseOptionRate = (text: string): number | null => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (!m) return null;
  return splitBracketParts(m[1].replace(/"/g, '')).rate;
};

/** 选项最终成功率（UI 徽标与骰子判定的唯一解析点，两处禁止各写一套）：
 *  AI 标注优先，无标注时按风险档位兜底，无档位无标注 → null（不掷骰）。 */
export const resolveOptionSuccessRate = (text: string): number | null => {
  const rate = parseOptionRate(text);
  if (rate !== null) return rate;
  const style = parseOptionStyle(text);
  return style ? GRADE_FALLBACK_RATE[style] : null;
};

export const parseOptionContent = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return text.slice(m[0].length);
  const sep = findOptionSep(text);
  return sep ? text.slice(sep.idx + sep.len) : text;
};