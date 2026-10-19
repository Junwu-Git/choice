/**
 * 知识边界报告的纯函数层：模型输出 → 增量补丁 → 合并后的表 → 分析用表格 / 迁移。
 *
 * 为什么是增量补丁而不是每次全量重写：报告随聊天长期存在，全量重写会让模型每轮重新输出
 * 整张表（token 随表变大线性增长），且早期条目滚出上下文窗口后会被静默丢掉。改为
 * 「只读新增对话、只输出变化」，表是累积的记忆，请求只随增量增长。
 *
 * 为什么条目要有稳定 ID：topic 是模型写的短标题，同一件事换个说法就会变成两条重复记录；
 * 用户手动改名也会被当成删除+新增。ID 创建后不变，AI 补丁按 ID 回传，本地再叠加
 * 主题/别名/相似度三层兜底匹配——弱模型漏传 ID 时仍能归并到同一条。
 *
 * 与 knowledge-analysis.ts（发请求、写 store）刻意分离：本模块零酒馆运行时依赖，
 * 解析/合并/容量/迁移这类易出错的逻辑必须能被 vitest 直接覆盖（同 option-parse.ts 的动机）。
 */

import { STRIP_REASONING_TAGS_RE, stripTrailingCommas } from '@/core/option-parse';
import { bigramsOf, textSimilarity } from '@/core/text-similarity';
import type {
  KnowledgeChange,
  KnowledgeChangeKind,
  KnowledgeImportance,
  KnowledgeReport,
  KnowledgeReportEntry,
  KnowledgeSource,
  KnowledgeStatus,
} from '@/type/settings';

/** 单次解析上限：模型偶尔会把同一信息拆成十几行，超过这个量级注入文本会反客为主。 */
export const MAX_PARSED_ENTRIES = 40;

/** 活跃条目存储上限：增量更新只增不减，必须有一个硬上限防长聊无限膨胀。 */
export const MAX_STORED_ENTRIES = 60;

/** 退役条目上限：软删除保留可恢复，但历史噪音不能无限堆积。 */
export const MAX_RETIRED_ENTRIES = 20;

/** 变更记录上限：面板只展示最近这些，旧记录没有追溯价值。 */
export const MAX_CHANGES = 20;

/** 别名/检索词上限：防止模型把整段设定塞进单个字段。
 *  条数之外还要限单条长度——弱模型常把整句描述当别名回传，超长别名会污染
 *  相似度匹配（归一化后与太多条目的二元组重合），也让注入表格难以阅读。 */
export const MAX_ALIASES = 6;
export const MAX_KEYWORDS = 8;
/** 单条别名的长度上限：别名是「同一件事的另一种叫法」，与 topic（24 字）同量级。
 *  取值须与 isSentenceLike 的 >16 字闸门一致——超过 16 字的项在归一化阶段已被整条丢弃，
 *  这里再写 24 只会让「上限」看起来比实际宽松。 */
export const MAX_ALIAS_LEN = 16;
/** 单条检索词的长度上限：人名/地名/物品名，正常远短于这个值。 */
export const MAX_KEYWORD_LEN = 24;

/** 剧情内时间字段的展示上限：只要「哪年哪月哪天/什么时候」，不需要完整叙述。 */
export const MAX_EVENT_TIME_LEN = 32;
/** 关联对象上限：人名/地名/物品名，正常远短于这个值（主题本身是 24 字）。 */
export const MAX_SUBJECT_LEN = 24;

/** 分析输入表格里 basis/impact 的展示长度：完整内容仍在报告里，表格只给判定所需的摘要。 */
export const MAX_TABLE_FIELD_LEN = 120;

/** 相似度归并阈值与领先幅度：与选项归因同源思路——分数接近说明两条都可能对，
 *  宁可不合并（记录 ambiguous）也不误并。 */
export const KNOWLEDGE_DEDUP_THRESHOLD = 0.72;
export const KNOWLEDGE_DEDUP_MARGIN = 0.08;

/** 手动整理的阈值：比 AI 路径更保守。批量动作误并会丢信息，漏并只是多一条。 */
export const MANUAL_DEDUP_THRESHOLD = 0.82;
export const MANUAL_DEDUP_MARGIN = 0.12;

/** 参与相似度归并的最短主题长度：低于此长度的主题（纯人名/地名）与太多条目共享
 *  二元组，靠相似度判定会误并。精确匹配（id/主题/别名）不受此限。 */
export const MIN_SIMILARITY_TOPIC_LEN = 4;

/** 注入默认预算（设置字段的兜底值，实际取值来自 KnowledgeSettings）。 */
export const MAX_INJECT_ENTRIES = 24;
export const INJECT_CHAR_BUDGET = 2500;

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  known: '已知',
  uncertain: '存疑',
  unknown: '未知',
};

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  witnessed: '目击',
  heard: '听闻',
  read: '阅读',
  inferred: '推断',
  none: '未获取',
  unspecified: '未标注',
  manual: '手动',
};

const STATUS_ALIAS: Record<string, KnowledgeStatus> = {
  已知: 'known',
  存疑: 'uncertain',
  未知: 'unknown',
  known: 'known',
  uncertain: 'uncertain',
  unknown: 'unknown',
};

/** 档位归一：模型可能写中文，也可能写 medium/middle；无法识别的落 normal。
 *  刻意不落 high——猜高会让约束项无端抢占预算，猜低会让真正要紧的条目被淘汰。 */
const IMPORTANCE_ALIAS: Record<string, KnowledgeImportance> = {
  高: 'high',
  重要: 'high',
  高重要: 'high',
  high: 'high',
  中: 'normal',
  一般: 'normal',
  普通: 'normal',
  中重要: 'normal',
  medium: 'normal',
  normal: 'normal',
  低: 'low',
  次要: 'low',
  低重要: 'low',
  low: 'low',
};

export const IMPORTANCE_LABEL: Record<KnowledgeImportance, string> = {
  high: '高',
  normal: '中',
  low: '低',
};

const normalizeImportance = (v: unknown): KnowledgeImportance =>
  typeof v === 'string' ? (IMPORTANCE_ALIAS[v.trim().toLowerCase()] ?? 'normal') : 'normal';

const SOURCE_ALIAS: Record<string, KnowledgeSource> = {
  目击: 'witnessed',
  亲眼: 'witnessed',
  听闻: 'heard',
  听说: 'heard',
  传闻: 'heard',
  阅读: 'read',
  读到: 'read',
  推断: 'inferred',
  推测: 'inferred',
  未获取: 'none',
  无: 'none',
  未标注: 'unspecified',
  手动: 'manual',
  witnessed: 'witnessed',
  heard: 'heard',
  read: 'read',
  inferred: 'inferred',
  none: 'none',
  unspecified: 'unspecified',
  manual: 'manual',
};

const normalizeStatus = (v: unknown): KnowledgeStatus =>
  typeof v === 'string' ? (STATUS_ALIAS[v.trim()] ?? 'unknown') : 'unknown';

const normalizeSource = (v: unknown): KnowledgeSource =>
  typeof v === 'string' ? (SOURCE_ALIAS[v.trim()] ?? 'unspecified') : 'unspecified';

/** 归一化主题用于比较：去空白、去括号注释、转小写（中文不受影响，英文缩写受益）。 */
const normalizeTopic = (s: string): string =>
  s
    .replace(/^\[id=[^\]]*\]\s*/i, '')
    .replace(/[\s【】[\]「」『』（）()]/g, '')
    .trim()
    .toLowerCase();

/** 条目的「身份说法」：只有 topic 与 aliases 定义它是什么事。
 *  keywords 是场景检索词（人名、地名、物品名），刻意不参与身份判定——同一角色的
 *  不同事实几乎都会共享同一批检索词，拿它当身份会让「她的身份」「她的情绪」「某条规矩」
 *  互相归并成一条。别名同理：补丁里的 aliases 是模型自由填写的，不拿来做匹配键。 */
const identityForms = (e: KnowledgeReportEntry): string[] =>
  [e.topic, ...e.aliases].map(normalizeTopic).filter(Boolean);

/** 字符串数组字段：接受数组或「逗号/顿号/换行」分隔的字符串，去重截断。
 *  除了条数与单条长度，还丢弃「明显是句子/结论」的项——模型常把
 *  「苏凛可能处于稳定期或发情边缘」这类判断当别名回传，它们既不能用于检索，
 *  也会让注入表格变成第二份依据说明。截断只会留下半句，故整条跳过。 */
const toStringArray = (v: unknown, max: number, maxLen: number): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、;；\n]/) : [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s || isSentenceLike(s)) continue;
    const cut = s.slice(0, maxLen);
    if (out.includes(cut)) continue;
    out.push(cut);
    if (out.length >= max) break;
  }
  return out;
};

/** 一条字符串是否更像句子/结论而不是「另一种叫法」。
 *  宁可漏判（留下一个偏长的别名）也不误杀正常简称，故只拦明确信号：
 *  - 句末标点；
 *  - 推测/因果情态词（「可能」「因为」「是否」…）；
 *  - 含时间推进或否定式的叙述（「前日…今日」「未…」「已经…了」）——
 *    这类是事件描述，不是「这件事的另一个叫法」；
 *  - 明显超出别名长度（>16 字）。
 *  别名/检索词是名词性短语，出现上述信号基本可判定为误填。
 *  导出供手动编辑路径复用：两条链路对「什么算别名」必须同口径。 */
export function isSentenceLike(s: string): boolean {
  if (/[。！？；]/.test(s)) return true;
  if (/(可能|应该|似乎|或许|是否|表明|说明|因为|所以|导致|意味着)/.test(s)) return true;
  // 事件叙述：时间推进（前日/今日、昨天/今天）、完成体（已经…了）、否定（未/没…）
  if (/(前日|昨日|昨天|今日|今天|明日|明天).*(后|已|未|又|再)/.test(s)) return true;
  if (/(已经|尚未|并未|没有|不再|再次)/.test(s)) return true;
  return s.length > 16;
}

/** 「模糊时段」信号：模型常把「某日上午」「下午」「傍晚」这类词当时间填进来。
 *  它们不是时间点，而是时段描述，既不能定位剧情先后，也和别的条目无法比较；
 *  更麻烦的是「某日」本身就承认了模型不知道具体日期——那等于编造。
 *  拦法分两层：
 *  1. 含「某日/某天/某年」这类占位词，一律判空（模型自己都说不出是哪天）；
 *  2. 只有时段词、没有任何数字或纪年锚点，也判空（「上午」「傍晚」）。
 *  刻意不做完整的日期格式校验：不同世界观有不同纪年（「第三纪元 3019 年」
 *  「民国二十三年」「翌日卯时」），强行套正则会把合法写法判成非法。 */
const VAGUE_TIME_PLACEHOLDER_RE = /某(?:日|天|年|月|时|刻)/;
const DAYPERIOD_RE = /^(?:凌晨|清晨|早上|早晨|上午|中午|正午|午后|下午|傍晚|黄昏|晚上|夜里|夜间|深夜|半夜|白天|今日|今天|昨日|昨天|明天|次日|翌日|同日)(?:时分|时候)?$/;
/** 有没有可定位的锚点：阿拉伯/中文数字（含纪年、时刻）、或明确的相对推进词。 */
const TIME_ANCHOR_RE = /[0-9０-９零一二三四五六七八九十百千两]|天前|天后|日后|时辰|更次|刻钟/;

/** 剧情内时间：接受字符串，归一空白并截断。空串表示「正文里没写时间」。
 *  除了格式归一，还要挡掉「某日上午」这类伪时间——见 VAGUE_TIME_PLACEHOLDER_RE。
 *  返回空串时调用方不应把「时间」字段写进注入或面板（等价于「正文没写」）。 */
export const toEventTime = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_TIME_LEN);
  if (!s) return '';
  if (VAGUE_TIME_PLACEHOLDER_RE.test(s)) return '';
  // 纯时段词（「上午」「傍晚」）没有可定位的锚点；带数字的「10月15日上午」保留
  if (DAYPERIOD_RE.test(s)) return '';
  if (!TIME_ANCHOR_RE.test(s)) return '';
  return s;
};

/** 关联对象清洗：名词性短标签，归一空白并限长。
 *  允许为空（旧档与模型漏填），不做句子过滤——「世界设定」这类通用标签合法。
 *  「未指定」「无」这类占位词判空，否则面板会多出一列无意义的「未指定」分组。 */
const EMPTY_SUBJECT_RE = /^(?:未指定|未标注|无|未知|不详|none|null|-|—)$/i;

export function normalizeSubject(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_LEN);
  return EMPTY_SUBJECT_RE.test(s) ? '' : s;
}

/** basis 清洗：把「没有信息量的依据句」降级成空串。
 *
 *  为什么值得单开一道：basis 是条目里唯一描述具体内容的字段（status 只是三态标签），
 *  但提示词一旦给出「unknown 写『未交代获取过程』」这类范例，弱模型会把它当模板刷满整列，
 *  注入侧每行都多一句空话、还挤掉有信息条目的预算；更糟的是增量合并里
 *  `basis = patch.basis || target.basis` 会用新模板句覆盖掉已有的具体依据。
 *  只拦两类零信息量写法（类别标签 / 自我复述判定结论），正常依据一律放行：
 *  - 「未交代获取过程」「只有读者可见」这类贴标签的；
 *  - 「没有依据」「未知」「不详」这类自认空缺的。
 *  宁可漏判（多留一句空话）也不误杀正常依据——误杀会让注入表格少一行说明。 */
const EMPTY_BASIS_RE = /^(?:未交代获取过程|没有交代获取过程|只有读者可见|只有读者能看到|无依据|没有依据|依据不详|未知|不详|无)$/;

export function normalizeBasis(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim().slice(0, 240);
  return EMPTY_BASIS_RE.test(s) ? '' : s;
}

/** 增量补丁：drop=true 删除该 topic；否则按 id/topic 覆盖或新增。
 *  id 可缺省（模型漏传时本地按 topic/别名/相似度兜底），drop 也允许只给 id。 */
export type KnowledgePatch =
  | { id?: string; topic: string; drop: true; drop_reason?: string }
  | {
      id?: string;
      topic: string;
      drop?: false;
      /** 缺省（模型没给）时更新路径保留旧值、新建路径回退 unknown/unspecified；
       *  status_explicit/source_explicit 区分「模型给了 unknown」与「模型没给」。 */
      status?: KnowledgeStatus;
      source?: KnowledgeSource;
      /** 档位：缺省同样保留旧值——模型只回 status 时不该把已有档位降回 normal。 */
      importance?: KnowledgeImportance;
      /** 关联对象：缺省保留旧值（旧模型/旧档不会带这个字段）。 */
      subject?: string;
      basis: string;
      impact: string;
      aliases: string[];
      keywords: string[];
      event_time: string;
      status_explicit?: boolean;
      source_explicit?: boolean;
      importance_explicit?: boolean;
    };

/** 宽松取单条补丁：id 或 topic 至少有一个；都没有的行无法定位，丢弃。 */
function pickPatch(x: unknown): KnowledgePatch | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const topic = (typeof o.topic === 'string' ? o.topic : '')
    .replace(/^\[id=[^\]]*\]\s*/i, '')
    .trim()
    .slice(0, 24);
  if (!id && !topic) return null;
  if (o.drop === true || o.drop === 'true') {
    return {
      id: id || undefined,
      topic,
      drop: true,
      drop_reason: typeof o.drop_reason === 'string' ? o.drop_reason.trim().slice(0, 120) : '',
    };
  }
  return {
    id: id || undefined,
    topic,
    status: normalizeStatus(o.status),
    source: normalizeSource(o.source),
    importance: normalizeImportance(o.importance),
    subject: normalizeSubject(o.subject),
    basis: normalizeBasis(o.basis),
    impact: typeof o.impact === 'string' ? o.impact.trim().slice(0, 240) : '',
    aliases: toStringArray(o.aliases, MAX_ALIASES, MAX_ALIAS_LEN),
    keywords: toStringArray(o.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN),
    event_time: toEventTime(o.event_time),
    status_explicit: o.status !== undefined && o.status !== null,
    source_explicit: o.source !== undefined && o.source !== null,
    importance_explicit: o.importance !== undefined && o.importance !== null,
  };
}

/** 去代码块包裹与前后缀文字。 */
const cleanModelText = (text: string): string =>
  text
    .replace(STRIP_REASONING_TAGS_RE, '')
    .trim()
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

/** 字符串感知地找最后一个完整 '}'：截断抢救用（流式代理可能在数组中途掐断）。 */
function lastCompleteBrace(text: string, from: number): number {
  let last = -1;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '}') last = i;
  }
  return last;
}

/** 从模型输出里抽出条目数组与 base_revision。
 *  支持对象（含 entries 键）、裸数组、代码围栏；截断时尽量抢救完整对象。
 *  返回 null = 完全没有可解析的 JSON；entries 为空数组 = 明确的「本轮无变化」。 */
export function parseKnowledgeResponse(
  text: string,
): { baseRevision: number | null; patches: KnowledgePatch[] } | null {
  const c = cleanModelText(text);
  if (!c) return null;

  const collect = (arr: unknown[], baseRevision: number | null) => {
    const byKey = new Map<string, KnowledgePatch>();
    for (const x of arr) {
      const patch = pickPatch(x);
      if (!patch) continue;
      // 同 id 或同 topic 后出现的覆盖先出现的（模型可能先 upsert 再 drop）
      byKey.set(patch.id ? `id:${patch.id}` : `topic:${normalizeTopic(patch.topic)}`, patch);
      if (byKey.size >= MAX_PARSED_ENTRIES) break;
    }
    return { baseRevision, patches: [...byKey.values()] };
  };

  const tryObject = (s: string): { baseRevision: number | null; entries: unknown[] } | null => {
    try {
      const parsed = JSON.parse(stripTrailingCommas(s));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const o = parsed as Record<string, unknown>;
      if (!Array.isArray(o.entries)) return null;
      const rev = typeof o.base_revision === 'number' ? o.base_revision : Number(o.base_revision);
      return { baseRevision: Number.isFinite(rev) ? rev : null, entries: o.entries };
    } catch {
      return null;
    }
  };

  const tryArray = (s: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(stripTrailingCommas(s));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  // 1) 整体就是 JSON（对象或数组）
  const wholeObject = tryObject(c);
  if (wholeObject) return collect(wholeObject.entries, wholeObject.baseRevision);
  const wholeArray = tryArray(c);
  if (wholeArray) return collect(wholeArray, null);

  // 2) 对象形态：从首个 '{' 起，先试完整对象，再按最后一个完整 '}' 抢救
  const objStart = c.indexOf('{');
  const arrStart = c.indexOf('[');
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const objEnd = c.lastIndexOf('}');
    if (objEnd > objStart) {
      const direct = tryObject(c.slice(objStart, objEnd + 1));
      if (direct) return collect(direct.entries, direct.baseRevision);
    }
    const last = lastCompleteBrace(c, objStart);
    if (last > objStart) {
      // 截断在 entries 数组中间：截到最后一个完整条目对象，再补数组与对象闭合
      const repaired = tryObject(`${c.slice(objStart, last + 1)}]}`);
      if (repaired) return collect(repaired.entries, repaired.baseRevision);
    }
    return null;
  }

  // 3) 裸数组形态
  if (arrStart === -1) return null;
  const arrEnd = c.lastIndexOf(']');
  if (arrEnd > arrStart) {
    const direct = tryArray(c.slice(arrStart, arrEnd + 1));
    if (direct) return collect(direct, null);
  }
  const last = lastCompleteBrace(c, arrStart);
  if (last > arrStart) {
    const repaired = tryArray(`${c.slice(arrStart, last + 1)}]`);
    if (repaired) return collect(repaired, null);
  }
  return null;
}

/** 兼容旧调用：只要补丁数组。返回 null = 模型输出里根本没有可解析的 JSON 数组；
 *  返回 [] = 解析成功但没有条目（明确的「本轮无变化」，是合法结果）。 */
export function parseKnowledgePatch(text: string): KnowledgePatch[] | null {
  return parseKnowledgeResponse(text)?.patches ?? null;
}

/** FNV-1a 32 位哈希：稳定、无依赖，用于从 topic + 楼层派生条目 ID。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 生成条目 ID：topic + 首次出现楼层，同一聊天内确定性、跨聊天可重复但互不干扰。 */
export function makeEntryId(topic: string, atMessage: number): string {
  return `kb_${fnv1a(`${topic}@${atMessage}`)}`;
}

function ensureUniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

const cloneEntry = (e: KnowledgeReportEntry): KnowledgeReportEntry => ({
  ...e,
  aliases: [...e.aliases],
  keywords: [...e.keywords],
});

export const IMPORTANCE_RANK: Record<KnowledgeImportance, number> = { low: 0, normal: 1, high: 2 };

/** 档位先验分：高 +3 / 中 0 / 低 −3。
 *  通胀自愈的关键——整表都标 high 时这一项对所有条目相同，相互抵消，
 *  排序自动退化成下面的新鲜度与场景信号，不会变成「谁先被标 high 谁永远在前」。 */
const IMPORTANCE_SCORE: Record<KnowledgeImportance, number> = { high: 3, normal: 0, low: -3 };

/** 新鲜度分档：越近更新的条目越可能约束当前这批候选。
 *  用相对「最新楼层」的差值而不是绝对楼层——长聊里绝对值没有意义；
 *  差值同时保证老条目随剧情推进自然衰减（这就是静态档位做不到的动态性）。 */
export const FRESHNESS_TIERS: ReadonlyArray<readonly [maxAge: number, score: number]> = [
  [8, 4],
  [30, 2],
  [80, 0],
];
const FRESHNESS_STALE_SCORE = -3;

export function freshnessScore(updatedAtMessage: number, latestMessage: number): number {
  const age = Math.max(0, latestMessage - updatedAtMessage);
  for (const [maxAge, score] of FRESHNESS_TIERS) if (age <= maxAge) return score;
  return FRESHNESS_STALE_SCORE;
}

/** 场景命中加分：检索词出现在最近几条消息里，说明这条此刻正相关。 */
export const SCENE_HIT_SCORE = 5;

/** 条目在所属状态组内的排序分（越大越靠前）。
 *  组成：档位先验 + 新鲜度 + 场景命中。三项都是加性，任何一项单独通胀都会被另两项摊平。
 *  注意它不决定跨组顺序——unknown 永远排在 known 前面是安全线，不由分数决定。 */
export function entrySortScore(
  entry: Pick<KnowledgeReportEntry, 'importance' | 'updated_at_message'>,
  latestMessage: number,
  sceneHits = 0,
): number {
  return (
    IMPORTANCE_SCORE[entry.importance] +
    freshnessScore(entry.updated_at_message, latestMessage) +
    (sceneHits > 0 ? SCENE_HIT_SCORE : 0)
  );
}

/** 合并两个字符串数组：限条数与单条长度，同样丢弃句子式项——
 *  合并路径会绕过解析期归一化，不在这里挡就会把超长/判断式别名带进表里。
 *  旧数组也一并清洗：历史上软上限把别名堆到几十条，只追加不清理会让脏数据永久留存。
 *  上限是硬的——先 push 再判断会让已满的数组每轮仍 +1。 */
const mergeUnique = (a: string[], b: string[], max: number, maxLen: number): string[] => {
  const out: string[] = [];
  for (const item of [...a, ...b]) {
    const s = item.replace(/\s+/g, ' ').trim();
    if (!s || isSentenceLike(s)) continue;
    const cut = s.slice(0, maxLen);
    if (out.includes(cut)) continue;
    out.push(cut);
    if (out.length >= max) break;
  }
  return out;
};

/** 变更记录工厂：at 是时间戳，at_message 是分析/操作时的楼层数。 */
function change(
  kind: KnowledgeChangeKind,
  entry: Pick<KnowledgeReportEntry, 'id' | 'topic'>,
  detail: string,
  at: number,
  atMessage: number,
): KnowledgeChange {
  return { at, at_message: atMessage, kind, id: entry.id, topic: entry.topic, detail };
}

const STATUS_DETAIL = (from: KnowledgeStatus, to: KnowledgeStatus): string =>
  `状态 ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`;

/** 合并结果：entries 是最终表；changes 供「最近变更」展示；changed 表示内容是否真的变了
 *  （只有 rejected_locked / drop_missing 这类空操作时为 false，报告修订号不递增）。 */
export type MergeResult = {
  entries: KnowledgeReportEntry[];
  changes: KnowledgeChange[];
  changed: boolean;
};

/**
 * 把补丁合并进已有表。目标解析顺序：
 *   id → 主题精确 → 别名精确 → 相似度（活跃条目）→ 新建。
 *  锁定条目完全冻结：不能更新、不能 drop、也不能通过改名绕过（相似度命中锁定同样拒绝）。
 *  退役条目只接受精确命中（id/主题/别名）恢复，相似度不恢复，避免误复活。
 */
export function mergeKnowledgePatch(
  existing: KnowledgeReportEntry[],
  patches: KnowledgePatch[],
  atMessage: number,
  now = Date.now(),
): MergeResult {
  const work = existing.map(cloneEntry);
  const usedIds = new Set(work.map(e => e.id).filter(Boolean));
  const changes: KnowledgeChange[] = [];
  let mutated = false;
  /** 本轮补丁实际写过的条目 id：容量淘汰时保护它们，避免「新增即被自己挤掉」。 */
  const touchedIds = new Set<string>();

  const findById = (id: string | undefined): KnowledgeReportEntry | undefined =>
    id ? work.find(e => e.id === id) : undefined;

  const findByTopic = (topic: string): KnowledgeReportEntry | undefined => {
    const key = normalizeTopic(topic);
    if (!key) return undefined;
    return work.find(e => normalizeTopic(e.topic) === key);
  };

  const findByAlias = (patch: KnowledgePatch): KnowledgeReportEntry | undefined => {
    // 只用补丁的 topic 去对条目的 topic/aliases：模型自填的 aliases 不可信——它常把
    // 「同一角色的相关事实」写成别名，拿它当匹配键会让一条补丁吸进整段剧情。
    // 代价是「换了说法 + 漏传 id」时可能多出一条重复，但重复可被「整理条目」回收，
    // 误并则会静默丢掉整条事实，两害相权取轻。
    const key = normalizeTopic(patch.topic);
    if (!key) return undefined;
    const hits = work.filter(e => identityForms(e).includes(key));
    // 别名命中多条时不猜：交给相似度/新建路径，避免把两条不同信息并成一条
    return hits.length === 1 ? hits[0] : undefined;
  };

  const findSimilar = (
    patch: KnowledgePatch,
  ): { entry: KnowledgeReportEntry; score: number; second: number; secondTopic: string } | null => {
    const topic = patch.topic;
    if (!topic) return null;
    // 只比「身份说法」：补丁的 topic 对条目的 topic/aliases。keywords 是场景检索词
    // （人名、地名、物品名），共享它只说明两条涉及同一对象，不说明是同一件事；
    // 把它纳入相似度会让「张子薇抽烟」和「张子薇逃课」凭共享人名直接满分归并。
    const patchKey = normalizeTopic(topic);
    let best: KnowledgeReportEntry | null = null;
    let bestScore = 0;
    let secondScore = 0;
    let secondTopic = '';
    for (const e of work) {
      if (e.retired) continue;
      const entryForms = identityForms(e);
      let score = 0;
      for (const b of entryForms) {
        const s = textSimilarity(patchKey, b);
        if (s > score) score = s;
      }
      // 太短的说法（纯人名/地名）不参与相似度归并：它们与太多条目共享二元组，
      // 靠相似度会误并成不同的事。精确匹配路径（id/topic/alias）仍能命中。
      if (Math.min(topic.length, e.topic.length) < MIN_SIMILARITY_TOPIC_LEN && score < 1) score = 0;
      if (score > bestScore) {
        secondScore = bestScore;
        secondTopic = best?.topic ?? '';
        bestScore = score;
        best = e;
      } else if (score > secondScore) {
        secondScore = score;
        secondTopic = e.topic;
      }
    }
    return best ? { entry: best, score: bestScore, second: secondScore, secondTopic } : null;
  };

  /** 改名绕过锁定：新 topic 与任一锁定条目高度相似，就视为对锁定条目的修改。 */
  const matchesLockedBySimilarity = (patch: KnowledgePatch): KnowledgeReportEntry | null => {
    if (!patch.topic) return null;
    for (const e of work) {
      if (!e.locked) continue;
      const score = Math.max(
        textSimilarity(patch.topic, e.topic),
        ...e.aliases.map(a => textSimilarity(patch.topic, a)),
      );
      if (score >= KNOWLEDGE_DEDUP_THRESHOLD) return e;
    }
    return null;
  };

  for (const patch of patches) {
    let target = findById(patch.id) ?? findByTopic(patch.topic) ?? findByAlias(patch);
    let matchedBy = target
      ? findById(patch.id) === target
        ? 'id'
        : findByTopic(patch.topic) === target
          ? 'topic'
          : 'alias'
      : '';

    if (!target) {
      const sim = findSimilar(patch);
      if (sim && sim.score >= KNOWLEDGE_DEDUP_THRESHOLD) {
        if (sim.score - sim.second >= KNOWLEDGE_DEDUP_MARGIN) {
          target = sim.entry;
          matchedBy = 'similarity';
        } else {
          // 分数接近：不自动合并，新建并留下可追踪记录（用户能看懂为什么多了一条）
          changes.push(
            change(
              'ambiguous',
              { id: '', topic: patch.topic },
              `与「${sim.entry.topic}」「${sim.secondTopic || '其他条目'}」相似度接近（${sim.score.toFixed(2)} / ${sim.second.toFixed(2)}），未自动合并`,
              now,
              atMessage,
            ),
          );
        }
      }
    }

    if (target?.locked) {
      changes.push(
        change('rejected_locked', target, `锁定条目，已忽略 AI 的${patch.drop ? '删除' : '修改'}`, now, atMessage),
      );
      continue;
    }

    if (!target) {
      const lockedHit = matchesLockedBySimilarity(patch);
      if (lockedHit) {
        changes.push(
          change(
            'rejected_locked',
            lockedHit,
            `与锁定条目「${lockedHit.topic}」高度相似，已拒绝改名绕过`,
            now,
            atMessage,
          ),
        );
        continue;
      }
    }

    if (patch.drop) {
      if (!target) {
        changes.push(
          change(
            'drop_missing',
            { id: patch.id ?? '', topic: patch.topic },
            '未找到对应条目，忽略删除',
            now,
            atMessage,
          ),
        );
        continue;
      }
      if (target.retired) continue;
      target.retired = true;
      target.retired_reason = patch.drop_reason || 'AI 判定信息已失效';
      target.revision += 1;
      target.updated_at_message = atMessage;
      changes.push(change('retired', target, target.retired_reason, now, atMessage));
      mutated = true;
      continue;
    }

    const wasRetired = target?.retired === true;
    if (target) {
      const beforeStatus = target.status;
      const detailParts: string[] = [];
      if (wasRetired) {
        target.retired = false;
        target.retired_reason = '';
        detailParts.push('恢复已退役条目');
      }
      // 只有 AI 显式按 id 回传时才允许改 topic（明确改名）；按别名或相似度归并时
      // 沿用表里既有的主题名，把新说法并入别名——否则「货仓」会把「仓库位置」整条改名。
      if (matchedBy === 'id') {
        target.topic = patch.topic || target.topic;
      } else if (patch.topic && normalizeTopic(patch.topic) !== normalizeTopic(target.topic)) {
        target.aliases = mergeUnique(target.aliases, [patch.topic], MAX_ALIASES, MAX_ALIAS_LEN);
      }
      // 只有模型显式给的字段才覆盖：弱模型有时只回部分字段，缺 status 会被归一成
      // unknown，直接覆盖会把一条 known 误降级成「不知道」，污染整张表。
      if (patch.status_explicit !== false && patch.status) target.status = patch.status;
      if (patch.source_explicit !== false && patch.source) target.source = patch.source;
      // 档位同样只在显式给出时覆盖：模型常只回 status/impact，缺 importance 时
      // 不该把用户或上一轮判定的 high 降回 normal（那等于静默丢权重）
      if (patch.importance_explicit !== false && patch.importance) target.importance = patch.importance;
      // 关联对象同样只在模型给了非空值时覆盖：漏填不该把已分类的条目打回未分类
      if (patch.subject) target.subject = patch.subject;
      if (beforeStatus !== target.status) {
        detailParts.push(STATUS_DETAIL(beforeStatus, target.status));
        // 只留一跳来路：面板据此标「由存疑转正」，完整历史仍在 last_changes
        target.previous_status = beforeStatus;
      }
      // 三态与获取方式交叉校验：不知道的信息不可能有获取方式；声称已知却没有获取过程时降级存疑
      if (target.status === 'unknown') target.source = 'none';
      else if (target.source === 'none' && target.status === 'known') target.status = 'uncertain';
      // 模板句清洗放在合并层（数据进报告的总闸）而不是只放在解析层：补丁也可能来自
      // 手动导入等绕过解析的路径，清洗后模板句变空串，于是旧的具体依据得以保留
      target.basis = normalizeBasis(patch.basis) || target.basis;
      target.impact = patch.impact || target.impact;
      target.aliases = mergeUnique(target.aliases, patch.aliases ?? [], MAX_ALIASES, MAX_ALIAS_LEN);
      target.keywords = mergeUnique(target.keywords, patch.keywords ?? [], MAX_KEYWORDS, MAX_KEYWORD_LEN);
      // 时间只在模型给出时覆盖：旧值往往是更早、更接近事件发生时的判定
      if (patch.event_time) target.event_time = patch.event_time;
      target.updated_at_message = atMessage;
      target.revision += 1;
      touchedIds.add(target.id);
      const kind: KnowledgeChangeKind = wasRetired
        ? 'restored'
        : matchedBy === 'similarity' || matchedBy === 'alias'
          ? 'merged'
          : 'updated';
      if (matchedBy === 'similarity') detailParts.push('按主题相似度归并');
      else if (matchedBy === 'alias') detailParts.push('按别名归并');
      changes.push(change(kind, target, detailParts.join('；') || '内容已刷新', now, atMessage));
      mutated = true;
      continue;
    }

    const baseId = patch.id?.trim() || makeEntryId(patch.topic, atMessage);
    const id = ensureUniqueId(baseId, usedIds);
    usedIds.add(id);
    const status = patch.status ?? 'unknown';
    const entry: KnowledgeReportEntry = {
      id,
      topic: patch.topic,
      subject: patch.subject ?? '',
      aliases: [...(patch.aliases ?? [])],
      keywords: [...(patch.keywords ?? [])],
      status,
      source: status === 'unknown' ? 'none' : (patch.source ?? 'unspecified'),
      importance: patch.importance ?? 'normal',
      previous_status: '',
      basis: patch.basis,
      impact: patch.impact,
      event_time: patch.event_time,
      first_seen_message: atMessage,
      updated_at_message: atMessage,
      revision: 1,
      locked: false,
      retired: false,
      retired_reason: '',
    };
    if (entry.source === 'none' && entry.status === 'known') entry.status = 'uncertain';
    work.push(entry);
    touchedIds.add(entry.id);
    changes.push(change('added', entry, '新增条目', now, atMessage));
    mutated = true;
  }

  // 容量治理：先清退役条目（最久未更新优先），再清活跃条目（已知最先淘汰，锁定永不淘汰）。
  // 退役淘汰同样跳过锁定条目——锁定语义是「完全冻结」，不能因为先退役再超限就被清掉。
  const retired = work.filter(e => e.retired && !e.locked);
  if (retired.length > MAX_RETIRED_ENTRIES) {
    const drop = new Set(
      [...retired]
        .sort((a, b) => a.updated_at_message - b.updated_at_message)
        .slice(0, retired.length - MAX_RETIRED_ENTRIES)
        .map(e => e.id),
    );
    for (const e of work) {
      if (!drop.has(e.id)) continue;
      changes.push(change('evicted', e, '退役条目超出上限，已清理最久未更新的记录', now, atMessage));
      mutated = true;
    }
    for (let i = work.length - 1; i >= 0; i--) if (drop.has(work[i].id)) work.splice(i, 1);
  }

  const active = work.filter(e => !e.retired);
  if (active.length > MAX_STORED_ENTRIES) {
    // 淘汰优先级：已知（约束力最弱）→ 存疑 → 未知，同组内按注入侧同一个排序分从低到高清；
    // 锁定条目永不淘汰。只淘汰到刚好回到上限，不按分档配额重排——
    // 按配额分档会先把 unknown 的新条目挤掉，与「未知优先保留」的注入口径相反。
    // 本轮刚写入的条目不参与淘汰：否则锁定占满时，新条目会把自己挤掉（新增即消失）。
    // 同组用 entrySortScore（而不是单纯最久未更新）：老的高档位条目会因新鲜度衰减先走，
    // 近期但低档位的条目反而留下——与注入排序保持同一套取舍口径，避免两处判断打架。
    const need = active.length - MAX_STORED_ENTRIES;
    const evict = new Set<string>();
    for (const status of ['known', 'uncertain', 'unknown'] as KnowledgeStatus[]) {
      if (evict.size >= need) break;
      const group = active
        .filter(e => e.status === status && !e.locked && !touchedIds.has(e.id))
        .sort(
          (a, b) =>
            entrySortScore(a, atMessage) - entrySortScore(b, atMessage) ||
            a.updated_at_message - b.updated_at_message,
        );
      for (const e of group) {
        if (evict.size >= need) break;
        evict.add(e.id);
      }
    }
    // 锁定条目占满上限时无可淘汰对象：临时允许超限，但必须留痕。
    // 静默超限会让用户以为上限失效；静默丢弃新条目更糟——刚新增的条目会立刻消失。
    if (evict.size < need) {
      changes.push(
        change(
          'capacity_full',
          { id: '', topic: '' },
          `活跃条目已达上限 ${MAX_STORED_ENTRIES} 条，其余条目均被锁定或为本轮新增，本次允许临时超出 ${need - evict.size} 条`,
          now,
          atMessage,
        ),
      );
    }
    for (const e of work) {
      if (!evict.has(e.id)) continue;
      changes.push(change('evicted', e, '活跃条目超出上限，已淘汰最久未更新的记录', now, atMessage));
      mutated = true;
    }
    for (let i = work.length - 1; i >= 0; i--) if (evict.has(work[i].id)) work.splice(i, 1);
  }

  return { entries: work, changes: changes.slice(0, MAX_CHANGES), changed: mutated };
}

/** 重复候选组：同组条目被判定为「同一件事」，可合并。 */
export type DuplicateGroup = {
  /** 保留的条目（状态最权威、更新最近的） */
  keep: KnowledgeReportEntry;
  /** 被并入的条目 */
  merge: KnowledgeReportEntry[];
  /** 组内最高相似度，供 UI 展示把握程度 */
  score: number;
};

/** 状态权威度：known 最可信，unknown 最弱。合并时保留权威度更高的状态。 */
const STATUS_RANK: Record<KnowledgeStatus, number> = { known: 3, uncertain: 2, unknown: 1 };

/**
 * 扫描整表的重复条目（手动整理入口，AI 不参与）。
 *
 * 为什么需要它：AI 只在输出补丁时顺手归并，早期条目一旦滚出上下文就再也不会被重提，
 * 于是「同一件事的两种说法」会长期并存。这里做一次全表 O(n²) 扫描——上限 60 条，
 * 开销可忽略，且只在用户点「整理」时执行。
 *
 * 判定比 AI 路径更保守：要求「综合相似度 ≥ 0.82 且领先 ≥ 0.12」（AI 路径是 0.72/0.08）。
 * 自动整理是批量动作，误并的代价（丢信息）远大于漏并（多一条）。
 * 锁定条目一律不参与——用户已表态，不能被批量操作改动。
 *
 * 光有相似度不够：「张子薇抽烟」与「张子薇逃课」共享人名，Dice 会偏高。再加一道
 * 「区别词」校验——两边去掉公共部分后各自剩下的字，必须有一边足够短（说明只是换了
 * 说法），否则视为不同信息。这是纯标题比对做不到的，也是 AI 路径误并的根因。
 */
export function findDuplicateGroups(entries: KnowledgeReportEntry[]): DuplicateGroup[] {
  const active = entries.filter(e => !e.retired && !e.locked && e.topic);
  const formsOf = (e: KnowledgeReportEntry): string[] =>
    [e.topic, ...e.aliases, ...e.keywords].map(normalizeTopic).filter(Boolean);
  const pairScore = (a: KnowledgeReportEntry, b: KnowledgeReportEntry): number => {
    let best = 0;
    for (const x of formsOf(a)) for (const y of formsOf(b)) best = Math.max(best, textSimilarity(x, y));
    return best;
  };

  const groups: DuplicateGroup[] = [];
  const consumed = new Set<string>();
  // 从最近更新的条目开始：它最可能是当前有效的说法
  const ordered = [...active].sort((a, b) => b.updated_at_message - a.updated_at_message);
  for (const anchor of ordered) {
    if (consumed.has(anchor.id)) continue;
    const peers: { entry: KnowledgeReportEntry; score: number }[] = [];
    let best = 0;
    for (const other of ordered) {
      if (other.id === anchor.id || consumed.has(other.id)) continue;
      if (!isSameFact(anchor, other)) continue;
      const score = pairScore(anchor, other);
      if (score >= MANUAL_DEDUP_THRESHOLD) {
        peers.push({ entry: other, score });
        if (score > best) best = score;
      }
    }
    if (!peers.length) continue;
    // 领先幅度：必须明显高于「第二像的那条」，否则宁可不动
    const sorted = peers.sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const second = sorted[1];
    if (second && top.score - second.score < MANUAL_DEDUP_MARGIN) continue;

    consumed.add(anchor.id);
    const merge = sorted.filter(p => p.score >= MANUAL_DEDUP_THRESHOLD).map(p => p.entry);
    for (const m of merge) consumed.add(m.id);
    groups.push({ keep: anchor, merge, score: best });
  }
  return groups;
}

/** 两条条目是否可能指同一件事：在全部说法组合里，找最相似的一对，
 *  要求「共同部分之外剩下的字」至少有一边很短——即只是换了说法，不是两件事。 */
function isSameFact(a: KnowledgeReportEntry, b: KnowledgeReportEntry): boolean {
  const formsOf = (e: KnowledgeReportEntry): string[] =>
    [e.topic, ...e.aliases, ...e.keywords].map(normalizeTopic).filter(Boolean);
  const aForms = formsOf(a);
  const bForms = formsOf(b);
  for (const x of aForms) {
    for (const y of bForms) {
      if (isRestatement(x, y)) return true;
    }
  }
  return false;
}

/** 两个归一化说法是否「只是换了说法」：短串几乎被长串覆盖才算。
 *
 *  只看「包含关系」不够：`张子薇抽烟` 与 `张子薇逃课` 都能通过 keywords 里的
 *  「张子薇」与对方 topic 形成包含，于是两条不同的事被判成同一条。人名/地名这类
 *  高频词是判重的主要污染源，故要求「覆盖度」而不只是「出现过」：
 *  短串的二元组要有 ≥0.6 落在长串里。`张子薇`(3 字, 2 个二元组) 对
 *  `张子薇逃课` 覆盖度 1.0——仍会命中，所以再加一道长度闸门：
 *  短串必须至少 4 个字，避免把纯人名/纯地名当成一件事的说法变体。 */
function isRestatement(x: string, y: string): boolean {
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  // 太短的串（人名、地名、单一名词）不足以判定「同一件事」，交给精确匹配路径
  if (short.length < 4) return false;
  if (long.includes(short)) return true;
  const shared = bigramsOf(short);
  const longBigrams = bigramsOf(long);
  let inter = 0;
  for (const g of shared) if (longBigrams.has(g)) inter += 1;
  return (shared.size ? inter / shared.size : 0) >= 0.6;
}

/** 合并一组重复条目：保留 keep，把其余条目的别名/检索词/时间并入，状态取权威度最高的。
 *  纯函数，返回新数组；调用方负责写回 store 与记变更。 */
export function mergeDuplicateGroup(
  entries: KnowledgeReportEntry[],
  group: DuplicateGroup,
  atMessage: number,
  now = Date.now(),
): { entries: KnowledgeReportEntry[]; change: KnowledgeChange } {
  const keepId = group.keep.id;
  const mergedIds = new Set(group.merge.map(e => e.id));
  const result = entries.filter(e => !mergedIds.has(e.id)).map(cloneEntry);
  const target = result.find(e => e.id === keepId);
  if (!target) {
    return {
      entries: result,
      change: change('merged', group.keep, '目标条目已不存在，跳过', now, atMessage),
    };
  }
  for (const src of group.merge) {
    target.aliases = mergeUnique(target.aliases, [src.topic, ...src.aliases], MAX_ALIASES, MAX_ALIAS_LEN);
    target.keywords = mergeUnique(target.keywords, src.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN);
    // 时间取更早的那条（更接近事件发生时的判定）
    if (!target.event_time && src.event_time) target.event_time = src.event_time;
    // 状态取更权威的一方；来路记进 previous_status 便于面板标注
    if (STATUS_RANK[src.status] > STATUS_RANK[target.status]) {
      target.previous_status = target.status;
      target.status = src.status;
      target.source = src.source;
    }
    if (!target.basis && src.basis) target.basis = src.basis;
    if (!target.subject && src.subject) target.subject = src.subject;
    if (!target.impact && src.impact) target.impact = src.impact;
    // 档位取更高的一侧：合并意味着两处说法指向同一件事，其中任一处判定「漏了会越界」
    // 都成立——降档会静默丢掉约束
    if (IMPORTANCE_RANK[src.importance] > IMPORTANCE_RANK[target.importance]) target.importance = src.importance;
    target.first_seen_message = Math.min(target.first_seen_message || src.first_seen_message, src.first_seen_message);
  }
  target.updated_at_message = atMessage;
  target.revision += 1;
  return {
    entries: result,
    change: change(
      'merged',
      target,
      `手动整理：并入 ${group.merge.length} 条重复条目（相似度 ${group.score.toFixed(2)}）`,
      now,
      atMessage,
    ),
  };
}

const truncateField = (s: string): string =>
  s.length > MAX_TABLE_FIELD_LEN ? `${s.slice(0, MAX_TABLE_FIELD_LEN)}…` : s;

/** 渲染「已有知识边界表」块，作为增量分析的输入。空表返回 ''。
 *  只列活跃条目；锁定标记必须让模型看见，否则它会反复尝试修改被拒。
 *  档位一并显示：模型需要看到现有档位才可能提出改档（否则只能凭记忆猜）。 */
export function renderExistingTable(entries: KnowledgeReportEntry[], revision = 0): string {
  const active = entries.filter(e => e.topic && !e.retired);
  if (!active.length) return '';
  const lines = active.map(e => {
    const tags = [
      `[id=${e.id || '?'}]`,
      `[${STATUS_LABEL[e.status]}]`,
      `[来源=${SOURCE_LABEL[e.source]}]`,
      `[档位=${IMPORTANCE_LABEL[e.importance]}]`,
      e.subject ? `[对象=${e.subject}]` : '',
      e.locked ? '[锁定]' : '',
    ].filter(Boolean);
    const parts = [
      e.event_time ? `时间：${e.event_time}` : '',
      e.aliases.length ? `别名：${e.aliases.join('、')}` : '',
      e.keywords.length ? `检索词：${e.keywords.join('、')}` : '',
      e.basis ? `依据：${truncateField(e.basis)}` : '',
      e.impact ? `约束：${truncateField(e.impact)}` : '',
    ].filter(Boolean);
    return `- ${tags.join(' ')} ${e.topic}${parts.length ? `｜${parts.join('｜')}` : ''}`;
  });
  return [`当前修订号=${revision}；活跃条目 ${active.length} 条`, ...lines].join('\n');
}

/** 聊天内容指纹：只取可见消息的 role + 正文摘要，忽略扩展自身写入的元数据。
 *  为什么不用楼层数：编辑/删除/切分支都可能保持楼层数不变，必须看内容。
 *
 *  分两层：尾部 12 条逐条完整参与（最可能被改动、也最影响下一轮判定）；更早的楼层
 *  按步长抽样（每 8 条取一条的头 80 字）——长聊里改掉早期一条「谁告诉了主角什么」
 *  同样必须触发重算，但逐条全量哈希会让每次事件都扫整个聊天。抽样层只负责「早期有没有
 *  变」，漏判概率远低于只看尾部；真要精确到单条，应由 MESSAGE_UPDATED 记录 dirty 楼层。 */
const FINGERPRINT_TAIL = 12;
const FINGERPRINT_EARLY_STEP = 8;
const FINGERPRINT_EARLY_SNIPPET = 80;

export function computeChatFingerprint(
  messages: Array<{ mes?: unknown; is_system?: boolean; is_user?: boolean; role?: string }>,
): string {
  const visible = messages.filter(m => !m.is_system);
  const roleOf = (m: { is_user?: boolean; role?: string }): string => m.role ?? (m.is_user ? 'user' : 'assistant');
  const tailStart = Math.max(0, visible.length - FINGERPRINT_TAIL);
  const early: string[] = [];
  for (let i = 0; i < tailStart; i += FINGERPRINT_EARLY_STEP) {
    const text = String(visible[i].mes ?? '');
    early.push(`${roleOf(visible[i])}:${text.length}:${text.slice(0, FINGERPRINT_EARLY_SNIPPET)}`);
  }
  const tail = visible.slice(tailStart).map(m => {
    const text = String(m.mes ?? '');
    return `${roleOf(m)}:${text.length}:${text.slice(0, 400)}`;
  });
  return `${visible.length}:${fnv1a([...early, '|', ...tail].join('\n'))}`;
}

/** 导出格式版本：导入侧据此拒绝未来格式，避免把不认识的字段静默吞掉。 */
export const KNOWLEDGE_EXPORT_VERSION = 1;
export const KNOWLEDGE_EXPORT_TYPE = 'choice-knowledge-export';

export type KnowledgeExport = {
  type: typeof KNOWLEDGE_EXPORT_TYPE;
  version: number;
  exported_at: number;
  entries: KnowledgeReportEntry[];
};

/** 导出当前报告的活跃条目（不含退役与变更记录：导入是「搬知识」，不是搬历史）。 */
export function buildKnowledgeExport(entries: KnowledgeReportEntry[], now = Date.now()): KnowledgeExport {
  return {
    type: KNOWLEDGE_EXPORT_TYPE,
    version: KNOWLEDGE_EXPORT_VERSION,
    exported_at: now,
    entries: entries.filter(e => !e.retired).map(cloneEntry),
  };
}

/** 解析导入文件。返回 null = 不是本扩展的导出格式（调用方据此提示）。
 *  条目走与迁移相同的清洗路径，不信任外部文件里的脏字段。 */
export function parseKnowledgeExport(text: string): KnowledgeReportEntry[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== KNOWLEDGE_EXPORT_TYPE) return null;
  if (typeof o.version !== 'number' || o.version > KNOWLEDGE_EXPORT_VERSION) return null;
  if (!Array.isArray(o.entries)) return null;
  return migrateKnowledgeReport({
    updated_at: 0,
    based_on_message: 0,
    based_on_fingerprint: '',
    revision: 0,
    entries: o.entries as KnowledgeReportEntry[],
    last_changes: [],
  }).entries;
}

/** 落库前的三项守卫（纯函数，可单测）。 *  三种语义不同，不能合并：
 *  - chatIdentity：跨聊天写错文件，必须丢弃且无法补偿；
 *  - fingerprint：聊天内容变了，旧结论已不适用；
 *  - revision：用户手动改过报告，以用户为准。
 *  返回 null 表示通过。放在本模块（而非 knowledge-state）是为了能被 vitest 直接覆盖——
 *  这是「旧结论写进新内容」的最后一道防线，必须锁定。 */
export function checkCommitGuards(
  before: { chatIdentity: string; fingerprint: string; revision: number },
  after: { chatIdentity: string; fingerprint: string; revision: number },
): 'chat-changed' | 'stale' | 'revision-changed' | null {
  if (after.chatIdentity !== before.chatIdentity) return 'chat-changed';
  if (after.fingerprint !== before.fingerprint) return 'stale';
  if (after.revision !== before.revision) return 'revision-changed';
  return null;
}

/** 旧报告就地迁移（幂等）：补齐稳定 ID、来源、别名/检索词、修订号与变更记录。
 *  同一 topic 的重复条目合并到第一条（保留最大 updated_at_message），其余主题并入别名。
 *  不改变用户已看到的结论（状态/依据/约束原样保留）。 */
export function migrateKnowledgeReport(report: KnowledgeReport, now = Date.now()): KnowledgeReport {
  const changes: KnowledgeChange[] = [...(report.last_changes ?? [])];
  const out: KnowledgeReportEntry[] = [];
  const byTopic = new Map<string, KnowledgeReportEntry>();
  const usedIds = new Set<string>();

  for (const raw of report.entries ?? []) {
    const topic = String(raw.topic ?? '').trim();
    if (!topic) continue;
    const key = normalizeTopic(topic);
    const existing = byTopic.get(key);
    if (existing) {
      // 先清洗已有别名再追加：旧档里可能存着超长/句子式别名，
      // 只追加不清理会让脏数据永久留在表里（迁移是唯一会扫全表的入口）
      existing.aliases = mergeUnique(
        toStringArray(existing.aliases, MAX_ALIASES, MAX_ALIAS_LEN),
        [topic],
        MAX_ALIASES,
        MAX_ALIAS_LEN,
      );
      existing.keywords = toStringArray(existing.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN);
      if (!existing.event_time && raw.event_time) existing.event_time = toEventTime(raw.event_time);
      if ((raw.updated_at_message ?? 0) > existing.updated_at_message) {
        existing.status = raw.status;
        existing.source = normalizeSource(raw.source);
        existing.importance = normalizeImportance(raw.importance);
        existing.subject = normalizeSubject(raw.subject) || existing.subject;
        existing.basis = raw.basis || existing.basis;
        existing.impact = raw.impact || existing.impact;
        existing.updated_at_message = raw.updated_at_message;
      }
      if (existing.status === 'unknown') existing.source = 'none';
      else if (existing.source === 'none' && existing.status === 'known') existing.status = 'uncertain';
      changes.unshift(change('merged', existing, `旧报告重复主题「${topic}」已合并`, now, existing.updated_at_message));
      continue;
    }
    const id = raw.id?.trim() || ensureUniqueId(makeEntryId(topic, raw.updated_at_message ?? 0), usedIds);
    usedIds.add(id);
    const rawAliases = Array.isArray(raw.aliases) ? raw.aliases.length : 0;
    const entry: KnowledgeReportEntry = {
      ...raw,
      id,
      topic,
      subject: normalizeSubject(raw.subject),
      aliases: toStringArray(raw.aliases, MAX_ALIASES, MAX_ALIAS_LEN),
      keywords: toStringArray(raw.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN),
      source: normalizeSource(raw.source),
      importance: normalizeImportance(raw.importance),
      event_time: toEventTime(raw.event_time),
      first_seen_message: raw.first_seen_message || raw.updated_at_message || 0,
      updated_at_message: raw.updated_at_message || 0,
      revision: raw.revision || 0,
      locked: raw.locked === true,
      retired: raw.retired === true,
      retired_reason: raw.retired_reason || '',
      // 旧档里 basis 可能被模板句刷满（v82 之前提示词给过「未交代获取过程」范例），
      // 清洗后置空，让后续增量补丁能填上有信息量的依据
      basis: normalizeBasis(raw.basis),
      impact: raw.impact || '',
    };
    // 三态与获取方式交叉校验：旧档可能存着「未知 + 目击」这类矛盾组合。
    // 合并路径有同样两道纠正（见 mergeKnowledgePatch），迁移是唯一扫全表的入口，
    // 不在这里补齐，矛盾条目会永久留在表里并进入注入文本。
    if (entry.status === 'unknown') entry.source = 'none';
    else if (entry.source === 'none' && entry.status === 'known') entry.status = 'uncertain';
    // 旧档的 evidence_floors 必须显式删除：上面 ...raw 会原样带回来，
    // 而 zod strip 后 validateInplace 的 _.assign 又会把它合并回落盘对象，
    // 不删就会随聊天文件一直残留（同全局设置迁移块的约定）。
    delete (entry as Record<string, unknown>).evidence_floors;
    // 模板句依据与超长别名一样属于静默清洗，必须留痕：用户看到「依据」列变空时，
    // 能在「最近变更」里找到原因，而不是以为内容凭空消失。
    if (raw.basis && !entry.basis) {
      changes.unshift(
        change('updated', entry, '依据为无信息量的模板句，已清空（下次分析会补写具体内容）', now, entry.updated_at_message),
      );
    }
    // 旧版本别名是软上限，会堆到几十个。截断是唯一的清洗入口，但静默丢弃会让用户
    // 以为条目内容凭空消失，故留一条可追溯的变更记录（只在真的发生截断时记）。
    if (rawAliases > entry.aliases.length) {
      changes.unshift(
        change(
          'updated',
          entry,
          `别名超出上限，已从 ${rawAliases} 条清理为 ${entry.aliases.length} 条`,
          now,
          entry.updated_at_message,
        ),
      );
    }
    byTopic.set(key, entry);
    out.push(entry);
  }

  return {
    updated_at: report.updated_at ?? 0,
    based_on_message: report.based_on_message ?? 0,
    based_on_fingerprint: report.based_on_fingerprint ?? '',
    revision: report.revision ?? 0,
    entries: out,
    last_changes: changes.slice(0, MAX_CHANGES),
  };
}
