/**
 * AI 输出的 `<options>` JSON 数组文本修复层：仅在 JSON 主路径（严格解析）失败后补救。
 *
 * 动机（聊天存档实测，2026-10）：AI 在 content 正文里嵌未转义的英文双引号
 * （`武没有理会那句"数到三"`），或把闭合标签写残（`</options` 少 `>`），都会让
 * JSON.parse 失败；失败后 parseOptions 落到括号回退，而整段文本里只有数组自己的一对
 * `[]`，于是整个数组被吞成一条「原始 JSON」选项显示给玩家（无正文、无档位、无需求值，
 * 点它还会把整段灌进输入框）。塌陷后条数不足又会触发 refill 补齐，故面板常见形态是
 * 「1 条垃圾 + N 条干净」。
 *
 * 只做「修复再试」：修复结果必须再次通过 JSON.parse 才被采纳，仍失败则交回既有回退
 * 路径——严格解析能通过的输入行为零变化，误判不会污染正常输出。
 * 纯函数、零依赖，便于单测覆盖。
 */

/** 剥离尾部残缺的 `</options>` 闭合标签。
 *  输出被截断时数组后面会拖 `</options`、`</optio`、`</` 等残片：parseOptions 的
 *  `</options>` 正则匹配不到，只按开标签切片，残片就留在数组文本尾部（实测样本结尾
 *  `…先谈。』"}]</options`）。只认「末尾 `<` 起的残片是 `</options>` 前缀」这一种形态，
 *  正文里正常的 `<`（后随其它字符，如 `a<b`）原样保留——残片内出现 `>` 即判为已闭合。 */
export const stripTrailingCloseTagFragment = (s: string): string => {
  const withoutFull = s.replace(/<\/\s*options\s*>\s*$/i, '');
  if (withoutFull !== s) return withoutFull.trimEnd();
  const lt = s.lastIndexOf('<');
  if (lt === -1) return s;
  const body = s
    .slice(lt + 1)
    .trim()
    .toLowerCase();
  if (body.includes('>')) return s;
  return '/options'.startsWith(body) ? s.slice(0, lt).trimEnd() : s;
};

/** 转义字符串态下的裸引号（AI 在正文里写 `那句"数到三"` 未转义）。
 *  判定：字符串内遇到 `"` 时看其后首个非空白字符——是结构字符 `,` `}` `]` `:`
 *  （含键名后紧跟的 `:`）才当闭合引号，否则判为正文裸引号并补 `\"`。
 *  已有转义（`\"`）与转义反斜杠（`\\`）按 JSON 词法跳过，不重复处理。
 *  歧义（成对裸引号且第二个恰好后随结构字符）可能把正文切早，但修复结果只有在
 *  JSON.parse 成功时才被采纳，且仅在严格解析已失败的文本上运行。 */
export const escapeStrayQuotes = (s: string): string => {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (ch !== '"') {
      out += ch;
      continue;
    }
    if (!inStr) {
      inStr = true;
      out += ch;
      continue;
    }
    let k = i + 1;
    while (k < s.length && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
    const next = s[k];
    if (next === ',' || next === '}' || next === ']' || next === ':') {
      inStr = false;
      out += ch;
    } else {
      out += '\\"';
    }
  }
  return out;
};

/** 修复层总入口：先剥残缺闭合标签、再转义正文裸引号，返回修复后的文本。
 *  与原文相同（`===`）即表示无可修复项，调用方据此跳过重试。 */
export const repairOptionArrayJson = (s: string): string => escapeStrayQuotes(stripTrailingCloseTagFragment(s));
