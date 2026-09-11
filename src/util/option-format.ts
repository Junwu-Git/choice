/**
 * 选项文本解析（共享层）：主面板 ActionOptionsPanel 与悬浮球弹窗 FloatingOptions
 * 共用同一份解析规则——分隔符/方括号标头/拆类型与内容的口径必须在两处保持一致，
 * 单边改动会造成同一选项在两组 UI 中显示不同。不要在两处各写一份。
 */

// 分隔符：半角/全角冒号后跟任意空白字符，与 generator.ts 的 parseOptions 正则保持一致
const OPTION_SEP_RE = /[:：]\s/;

// 匹配开头的 [标题] 或 【标题】 模式，标题为括号内文字，括号后紧跟内容
const OPTION_TYPE_BRACKET_RE = /^[[【]([^\]】]+)[\]】]\s*/;

const findOptionSep = (text: string): { idx: number; len: number } | null => {
  const m = text.match(OPTION_SEP_RE);
  return m ? { idx: m.index!, len: m[0].length } : null;
};

export const parseOptionType = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return m[1].replace(/"/g, '');
  const sep = findOptionSep(text);
  return sep ? text.slice(0, sep.idx).replace(/"/g, '') : text.replace(/"/g, '');
};

export const parseOptionContent = (text: string): string => {
  const m = text.match(OPTION_TYPE_BRACKET_RE);
  if (m) return text.slice(m[0].length);
  const sep = findOptionSep(text);
  return sep ? text.slice(sep.idx + sep.len) : text;
};