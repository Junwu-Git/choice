/**
 * 生成侧选项解析：模型原始输出 → 选项字符串数组（<options> 块提取 + JSON 主路径 + 回退）。
 *
 * 与展示侧解析（src/util/option-format.ts，拆解单条「[标题|档位|需求值]正文」的分段）
 * 分工不同：本模块只负责「一整段回复 → 若干条选项」。
 *
 * 从 generator.ts 迁出：纯函数、零酒馆运行时依赖，可被 vitest 直接单测——提取起点出过
 * 实测事故（见 parseOptions 注释），只靠浏览器复现兜底不住。
 */

import { repairOptionArrayJson } from '@/core/option-json-repair';

/** 思维链标签块剥离正则：parseOptions 共用。
 *  新增模型思维标签（如 <reasoning_content>/<antThinking>）时只改这一处即可同步，
 *  避免只补一处而另一处静默漏处理。String.replace 对 /g 正则不保留 lastIndex 状态，跨调用共享安全。 */
const STRIP_REASONING_TAGS_RE =
  /<(?:think(?:ing)?|reasoning|thought)>[\s\S]*?<\/(?:think(?:ing)?|reasoning|thought)>/gi;

/** 标签堆叠间隙判定：标题括号闭合后到同一下一个括号之间，仅含空白和/或 emoji 才算堆叠。
 *  输出契约是 "[标题]emoji 内容"，emoji 紧跟标题括号，AI 无视禁令在正文开头再加场景头
 *  括号时间隙就是"emoji+空白"（实测："[回溯闪回]🎞️ [记忆片段·三年前] 正文"曾被切成
 *  "[回溯闪回]🎞️" 和 "[记忆片段·三年前] 正文" 两条）。emoji 用 Unicode
 *  Extended_Pictographic 属性类 + 变体选择符/ZWJ/肤色修饰符，不枚举具体 emoji 码位
 *  （新 emoji 不断新增，枚举必漏）。修饰符不写成字符类 [\uFE0F\u200D…]*：字符类按码位
 *  逐一匹配，组合序列（旗子成对 Regional Indicator、修饰符必须紧跟基字符）会被错误放行，
 *  no-misleading-character-class 正是拦这个误用——修饰符只能紧跟 emoji，故用非捕获组
 *  列举修饰符码位（肤色五个码位用 \p{Emoji_Modifier} 涵盖，与 1F3FB-1F3FF 精确等价）。
 *  不用 v flag 字符类集合语法：ES2024，移动端 WebView 内核滞后不兼容。关键取舍：间隙里
 *  出现任何正文文字仍判为新选项——AI 把两条选项挤在一行（"[A]内容A [B]内容B"）必须
 *  拆开，区分依据是位置：场景头只会出现在任何正文之前（紧跟标题的 emoji 是格式的一部分），
 *  正文都写完了才出现的括号只可能是下一条选项的标题，哪怕内容以 emoji 收尾
 *  （"内容A🎞️ [B]…"）也按新选项拆 */
const TAG_STACK_GAP_RE = /^(?:[^\S\r\n]|\p{Extended_Pictographic}(?:\uFE0F|\u200D|\u20E3|\p{Emoji_Modifier})*)*$/u;

/** 字符串感知的尾随逗号清理：跳过引号区间，仅删除引号外 `,`+空白+`]`/`}` 处的逗号。
 *  不能用全局正则 `,(\s*[\]}])` 替换——它会命中字符串值内部的 ",]"/",}" 字面量，
 *  静默篡改选项正文（如列举示例"苹果,橘子]"）。 */
const stripTrailingCommas = (s: string): string => {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let k = i + 1;
      while (k < s.length && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
      if (s[k] === ']' || s[k] === '}') continue;
    }
    out += ch;
  }
  return out;
};

/** 剥离 markdown 代码块围栏（LLM 可能输出 ```json...```）。 */
const stripFences = (s: string): string =>
  s
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

/** 尝试把 `<options>` 块文本当 JSON 数组解析（主路径；解析失败走括号回退）。
 *  返回解析出的选项字符串数组，或 null（非数组 / 解析失败 / 解析后全空）。
 *  兼容多种元素形态：{title,content}、纯字符串、{text}、{option}、{t,c}、{type,content}。
 *  有 title 时重建为 `[title]content`（title 可带 |档位|需求值 标注，供骰子/档位消费）；
 *  内容含 []/【】/换行等任意字符都在 content 字符串里、依赖下游 ^ 锚定解析当内容处理，不切分。
 *  严格解析失败后经 option-json-repair 修复再试一次（残缺闭合标签 / 正文裸引号），
 *  仍失败才返回 null 交回括号回退——修复层细则见该模块注释。 */
const parseJsonOptionArray = (c: string): string[] | null => {
  /** 严格 JSON 解析 + 元素形态归一。解析失败向上抛（由调用方决定是否修复重试），
   *  非数组/全空则返回 null（文本本身合法，修复无从下手）。 */
  const fromJson = (s: string): string[] | null => {
    // 处理 JSON 尾随逗号（LLM 常见错误）：复用条目池路径的字符串感知版本——全局正则
    // `,(\s*[\]}])` 会命中字符串值内部的 ",]"/",}" 字面量，静默篡改选项正文
    const p = JSON.parse(stripTrailingCommas(s));
    if (!Array.isArray(p)) return null;
    const items = p
      .map(x => {
        if (typeof x === 'string') return x.trim();
        const title = typeof x?.title === 'string' ? x.title.trim() : '';
        const body =
          (typeof x?.content === 'string' ? x.content.trim() : null) ??
          (typeof x?.text === 'string' ? x.text.trim() : null) ??
          '';
        if (title) return body ? `[${title}]${body}` : `[${title}]`;
        // 无 title 但带 type（弱模型把方向词放进 type 字段）：映射成 [type]正文——与
        // {title,content} 同构（本契约里括号标题就是类型词）。旧的 `${type}: ${content}`
        // 模板分支对字符串 content 永不可达（body 已先行消费 content），类型信息丢失、
        // 归因的前缀匹配随之失效
        const typeAsTitle = typeof x?.type === 'string' ? x.type.trim() : '';
        if (typeAsTitle) return body ? `[${typeAsTitle}]${body}` : `[${typeAsTitle}]`;
        return (
          // 无 title 时回退链先查 body（已从 x.content 算出）：漏查会让
          // [{"content":"正文"}]（弱模型漏 title 字段，常见）被静默丢弃，
          // 与 {"text":"正文"} 可保留不对称——选项凭空变少且无提示。
          // body 为空串时继续回退（content:'' + text:'备用' 不应丢备用）
          (body || null) ??
          x?.text?.trim() ??
          x?.option?.trim() ??
          // ?? 右侧用 undefined 而非 ''，确保 '' 假值时链继续回退
          (x?.t && x?.c ? `${x.t}: ${x.c}` : undefined)
        );
      })
      .filter(Boolean);
    return items.length ? items : null;
  };

  try {
    const items = fromJson(c);
    if (items) return items;
    // 严格解析成功却无可用元素（非数组/解析后全空）：文本本身合法，修复无从下手
    return null;
  } catch {
    /* 严格解析失败 → 走修复再试 */
  }
  // 修复再试（残缺闭合标签 / 正文裸引号）：修复结果必须自身解析通过才采纳，仍失败则
  // 交回既有括号回退路径。文本无可修复项（=== 原文）时跳过，不白跑一遍解析
  const repaired = repairOptionArrayJson(c);
  if (repaired !== c) {
    try {
      return fromJson(repaired);
    } catch {
      /* not JSON */
    }
  }
  return null;
};

/** 标题质量闸门：括号里的"标题"得像个标题。纯数字/标点（引用标注 [1]、[2025-01-01]）与
 *  JSON 残片（[{"title":…）不是选项标题——拒答文本和 JSON 塌陷残片里的括号都长这样，
 *  不过闸门就会被当成选项起点（实测：Gemini 拒答里的 [guidelines](url) 曾被整条渲染成
 *  可点的"选项"）。 */
const isPlausibleBracketTitle = (raw: string): boolean => {
  const title = raw.trim();
  if (!title) return false;
  if (/^[\d\s.,、;；:：-]+$/.test(title)) return false;
  if (title.startsWith('{') || title.startsWith('[') || title.startsWith('"')) return false;
  if (title.includes('":')) return false;
  return true;
};

/** 选项起点锚定：括号必须"像个选项的开头"——行首（允许前导空白/emoji，复用标签堆叠
 *  间隙语义）或紧随「…：」式引导句尾（"以下是候选：[…"）。锚定只作用于起始匹配：
 *  散文里行内提及的括号（"…against my [guidelines](url)"）不是起点，跳过它继续往后找；
 *  起始匹配之后的括号沿用既有"间隙含正文即新选项"切分（AI 挤行的两条选项必须拆开，
 *  见 TAG_STACK_GAP_RE 注释），不改既有跨行/挤行行为。 */
const isOptionAnchor = (c: string, index: number): boolean => {
  const before = c.slice(c.lastIndexOf('\n', index - 1) + 1, index);
  return TAG_STACK_GAP_RE.test(before) || /[:：]\s*$/.test(before);
};

/** 标题行正则工厂：matchAll（/g）与 test 各持一份新实例，避免共享 /g 正则的 lastIndex
 *  跨调用串状态（test 在 /g 正则上会用上次位置继续匹配，是经典静默错）。 */
const makeTitleRe = (): RegExp => /([\u4e00-\u9fff]{2,5})[:：]\s*/g;

/** 括号/冒号回退路径（非 JSON 产出者，如旧提示词快照/老模型）。
 *  【】或 [] 格式——标题用【】或 [] 包裹，后续文本为内容，跨行自动合并。此路径下内容里
 *  再出现 []/【】仍可能被切（接受范围，历史上为兼容 run-on 与 【标题】 容错而保留）。
 *  边界判定按提示词契约"每条选项独占一行"做行锚定：只有行首（间隙含换行或正文）的
 *  括号才开启新选项。同一行内紧邻/仅隔空白或 emoji 的连续括号是"标签堆叠"（如
 *  "[回溯闪回]🎞️ [记忆片段·三年前] 正文"、"[回溯闪回]【三年前·初二暑假】正文"），
 *  必须并入同一条——AI 常无视禁令在正文里用【】/[]写场景头，若把每个括号都当边界，
 *  一条选项会被切成 "[标签]" 和 "[场景头]正文" 两条（实测发生过，emoji 变体亦然）。
 *  间隙含正文文字则仍拆分（AI 挤行的两条选项），见 TAG_STACK_GAP_RE 注释。
 *
 *  两道收窄闸门（防拒答/散文被渲染成伪选项，2026-10 实测事故）：起始匹配须过锚定+
 *  标题质量检查；旧格式行路径只保留有选项结构的行（散文行一律丢弃）。 */
const parseByBrackets = (c: string, count: number): string[] => {
  const bracketTitleRe = /[[【]([^\]】]+?)[\]】]\s*/g;
  // 质量闸门对全部匹配生效：引用标注/JSON 残片的括号既不开启新选项、也不参与切分
  // （"正文[1]继续"不再把一条选项切成两半）
  const matches = [...c.matchAll(bracketTitleRe)].filter(m => isPlausibleBracketTitle(m[1]));
  // 锚定闸门只作用于起始匹配：跳过散文里行内提及的括号，找到第一个真正的选项起点
  const firstIdx = matches.findIndex(m => isOptionAnchor(c, m.index!));
  if (firstIdx >= 0) {
    const result: string[] = [];
    // 上一个匹配里闭合括号之后的位置。match[0] 末尾的 \s* 会吞掉行尾换行，
    // 必须用 trimEnd 去掉后计算，否则换行被吞、无法判断下个括号是否在行首
    let prevCloseEnd = 0;
    // 最后一条已入列选项的括号起始位置：堆叠合并时从它整体重切片。不能用
    // "result[last] += gap + option" 拼接——那是纯空白间隙时代的写法，依赖"option 尾部被
    // trim 掉的空白恰好等于 gap"才不出错；emoji 间隙下 option 尾部带着 emoji、gap 又拼一遍，
    // 会产出 "[回溯闪回]🎞️🎞️ …" 这种 emoji 重复（实测发生过）
    let lastOptStart = 0;
    for (let i = firstIdx; i < matches.length; i++) {
      const m = matches[i];
      const start = m.index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : c.length;
      const option = c.slice(start, end).replace(/\r?\n/g, '').trim();
      // 间隙 = 上个闭合括号到本括号开头之间的文本。空白/emoji（含空串）→
      // 同一行标签堆叠，并入上一条；含换行或正文 → 新选项（保持既有跨行行为）
      const gap = c.slice(prevCloseEnd, start);
      const isTagStack = TAG_STACK_GAP_RE.test(gap);
      if (result.length > 0 && isTagStack) {
        result[result.length - 1] = c.slice(lastOptStart, end).replace(/\r?\n/g, '').trim();
      } else if (option) {
        result.push(option);
        lastOptStart = start;
      }
      prevCloseEnd = start + m[0].trimEnd().length;
    }
    if (result.length) return result.slice(0, count);
  }

  // 回退：旧格式 "标题: 内容"，按行解析
  // 先按换行分割，再在每行内按 "标题: 内容" 模式拆分，处理模型将多个选项写在同一行的情况
  const lines = c
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^<\/?\w+>$/i.test(l));
  // 行首 emoji 判定：v23 放开"内容开头可带 emoji"后，模型偶尔违规输出无 [标题] 的
  // emoji 行（如 "😏 提醒她：该吃饭了"）——"提醒她"命中标题正则会被误拆成两条。
  // 行首为 emoji 时整行保留、跳过标题拆分（纯容错，正常 "[标题]emoji 内容" 走主路径）。
  // 但保留须以行内确有标题结构为前提（见下），否则"😔 非常抱歉…"这类拒答/寒暄句
  // 也会被整行当成选项
  const leadingEmojiRe = /^\p{Extended_Pictographic}/u;
  const result: string[] = [];
  for (const line of lines) {
    if (leadingEmojiRe.test(line)) {
      if (makeTitleRe().test(line)) result.push(line);
      continue;
    }
    // 用 matchAll 获取所有标题匹配位置，按相邻匹配区间切片
    // 替换原有的 lastIdx 算法，解决第一个标题在 index 0 时后续选项丢失的 bug
    const matches = [...line.matchAll(makeTitleRe())];
    // 无标题结构的行一律丢弃：此前"整行保留"是伪选项的另一来源（拒答句/收尾说明
    // 逐行变成可点选项）。跨行内容续行在此被丢弃属接受范围——JSON 主路径与括号路径
    // 均不受影响，只有"纯散文 + 旧格式"这条兜底路径才吃这个代价
    if (matches.length === 0) continue;
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : line.length;
      result.push(line.slice(start, end).trim());
    }
  }
  return result.slice(0, count);
};

/** 收集候选提取区间（已剥离代码围栏），按优先级自后向前排列：
 *  1) 每个闭合标签配它前面最近的开标签——真实输出总在末尾，故从最后一个块往前试；
 *  2) 末尾未闭合的开标签之后到文末（输出被截断的形态）；
 *  3) 完全没有开标签时退回整段文本（旧提示词快照/老模型的裸格式）。
 *  同一开标签只产出一个区间（首个入选者优先），防提及区间与真实区间重复。
 *
 *  为什么不是「取第一个开标签」（旧实现）：实测事故里模型分析文本以散文提到
 *  「存入 <options> 的 JSON 数组中」，其后又逐条罗列候选设计，真实 JSON 块在末尾。
 *  取第一个开标签会让提取区间从散文提及处一路跨到真实块的闭合标签，区间不以 `[` 开头
 *  导致 JSON 主路径整段跳过，回退路径再把分析里的设计清单逐条当选项渲染
 *  （面板上出现一整屏带「（固定）：」尾巴的伪选项）。 */
const collectOptionRegions = (text: string): string[] => {
  const opens = [...text.matchAll(/<options>/gi)].map(m => m.index! + m[0].length);
  const closes = [...text.matchAll(/<\/options>/gi)].map(m => m.index!);
  const regions: string[] = [];
  const usedStarts = new Set<number>();
  const push = (start: number, end: number): void => {
    if (start >= end || usedStarts.has(start)) return;
    usedStarts.add(start);
    regions.push(stripFences(text.slice(start, end).trim()));
  };
  const lastOpen = opens.length ? opens[opens.length - 1] : -1;
  const lastClose = closes.length ? closes[closes.length - 1] : -1;
  // 末尾未闭合的开标签（最后一个开标签没有闭合在它之后的标签）：输出被截断的形态。
  // 它的起点比任何已闭合块都晚，故最先尝试
  if (lastOpen > lastClose) push(lastOpen, text.length);
  for (let i = closes.length - 1; i >= 0; i--) {
    const start = opens.filter(o => o <= closes[i]).pop();
    if (start !== undefined) push(start, closes[i]);
  }
  if (!opens.length) push(0, text.length);
  return regions;
};

/** 解析入口：AI 原始输出 → 选项字符串数组（≤ count 条）。
 *
 *  提取策略（自后向前逐候选区间，第一个产出结果的胜出）：每个候选先试 JSON 主路径，
 *  再试括号回退；回退路径内部已收窄（起点锚定 + 标题质量 + 结构行过滤，见
 *  parseByBrackets 注释），散文/拒答/提及片段产不出结果，自然继续试更早的候选区间。
 *
 *  全部候选都无结果时返回空数组：调用方据此提示「未能解析出任何选项」——这是拒答、
 *  散文、空输出等一切非选项输出的统一归宿。**勿再加"兜底返回第一个候选的回退结果"**：
 *  旧实现这么干过（firstAny），把拒答文本当选项渲染给玩家（实测事故，见
 *  parseByBrackets 注释），提示信息比伪选项好得多。 */
export function parseOptions(text: string, count: number): string[] {
  // 找到最后一个思维链闭合标签，丢弃它之前的所有内容
  // 原因：AI 可能在思维链中以文本形式提到 <options>（如"格式：<options> 标签内..."），
  // 直接在原始文本中 matchAll <options> 会误匹配到这些文本引用，导致提取错误
  const closeTagRe = /<\/(?:think(?:ing)?|reasoning|thought)>/gi;
  const closeMatches = [...text.matchAll(closeTagRe)];
  let c: string;

  if (closeMatches.length > 0) {
    const lastClose = closeMatches[closeMatches.length - 1];
    c = text.slice(lastClose.index! + lastClose[0].length).trim();
  } else {
    // 没有思维链闭合标签，剥离配对的思维链标签后使用全文
    c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();
  }

  const regions = collectOptionRegions(c);
  for (const region of regions) {
    // 主路径：JSON 数组（prompt 契约要求）；结构读出内容（含 []/【】/换行都安全）
    const jsonParsed = parseJsonOptionArray(region);
    if (jsonParsed) return jsonParsed.slice(0, count);
    const fallback = parseByBrackets(region, count);
    if (fallback.length) return fallback.slice(0, count);
  }
  return [];
}
