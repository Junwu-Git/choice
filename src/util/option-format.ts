/**
 * 选项文本解析（共享层）：主面板 ActionOptionsPanel 与悬浮球弹窗 FloatingOptions
 * 共用同一份解析规则——分隔符/方括号标头/拆类型与内容的口径必须在两处保持一致，
 * 单边改动会造成同一选项在两组 UI 中显示不同。不要在两处各写一份。
 *
 * v54 起支持 AI 输出侧的风险档位标注：标题内竖线标注（[标题|大胆]），
 * parseOptionType/parseOptionStyle 共享同一拆分口径；只有 `|` 后第二段命中
 * 受控词表才按档位拆，词表外整体当标题（防御自定义 type 含 `|` 的条目被误拆）。
 */

// 分隔符：半角/全角冒号后跟任意空白字符，与 generator.ts 的 parseOptions 正则保持一致
const OPTION_SEP_RE = /[:：]\s/;

// 匹配开头的 [标题] 或 【标题】 模式，标题为括号内文字，括号后紧跟内容
const OPTION_TYPE_BRACKET_RE = /^[[【]([^\]】]+)[\]】]\s*/;

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

/** 标题内 `|` 后的第二段命中受控词表 → 拆出档位并返回纯净标题；否则整段当标题、档位
 *  null。竖线两侧做 trim（容忍 AI 输出 "[顺势而为 | 大胆]" 的空格），
 *  第一段 trim 是相对旧行为的唯一放宽——旧标题带尾随空格会被 display 原样显示 */
const splitBracketTitle = (rawTitle: string): { title: string; style: OptionStyleGrade | null } => {
  const pipeIdx = rawTitle.indexOf('|');
  if (pipeIdx === -1) return { title: rawTitle, style: null };
  const styleWord = rawTitle.slice(pipeIdx + 1).trim().replace(/"/g, '');
  const style = STYLE_GRADE_WORDS[styleWord] ?? null;
  return style ? { title: rawTitle.slice(0, pipeIdx).trim(), style } : { title: rawTitle, style: null };
};

export const parseOptionType = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return splitBracketTitle(m[1].replace(/"/g, '')).title;
  const sep = findOptionSep(text);
  return sep ? text.slice(0, sep.idx).replace(/"/g, '') : text.replace(/"/g, '');
};

/** 档位分级解析：只处理 [标题] 括号形态（冒号分隔/无括号形态不参与档位标注）。
 *  无标注 / 词表外 / 老选项 → null，前端按中性样式渲染 */
export const parseOptionStyle = (text: string): OptionStyleGrade | null => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (!m) return null;
  return splitBracketTitle(m[1].replace(/"/g, '')).style;
};

export const parseOptionContent = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return text.slice(m[0].length);
  const sep = findOptionSep(text);
  return sep ? text.slice(sep.idx + sep.len) : text;
};