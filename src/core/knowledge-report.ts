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
/** 单条别名的长度上限：别名是「同一件事的另一种叫法」，与 topic（24 字）同量级。 */
export const MAX_ALIAS_LEN = 24;
/** 单条检索词的长度上限：人名/地名/物品名，正常远短于这个值。 */
export const MAX_KEYWORD_LEN = 24;

/** 剧情内时间字段的展示上限：只要「哪年哪月哪天/什么时候」，不需要完整叙述。 */
export const MAX_EVENT_TIME_LEN = 32;

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
 *  别名/检索词是名词性短语，出现上述信号基本可判定为误填。 */
function isSentenceLike(s: string): boolean {
  if (/[。！？；]/.test(s)) return true;
  if (/(可能|应该|似乎|或许|是否|表明|说明|因为|所以|导致|意味着)/.test(s)) return true;
  // 事件叙述：时间推进（前日/今日、昨天/今天）、完成体（已经…了）、否定（未/没…）
  if (/(前日|昨日|昨天|今日|今天|明日|明天).*(后|已|未|又|再)/.test(s)) return true;
  if (/(已经|尚未|并未|没有|不再|再次)/.test(s)) return true;
  return s.length > 16;
}

/** 剧情内时间：接受字符串，归一空白并截断。空串表示「正文里没写时间」。
 *  不校验格式——不同世界观有不同纪年（「第三纪元 3019 年」「民国二十三年」），
 *  强行套日期正则会把合法写法判成非法。 */
const toEventTime = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_TIME_LEN);
};

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
      basis: string;
      impact: string;
      aliases: string[];
      keywords: string[];
      event_time: string;
      status_explicit?: boolean;
      source_explicit?: boolean;
    };

/** 宽松取单条补丁：id 或 topic 至少有一个；都没有的行无法定位，丢弃。 */
function pickPatch(x: unknown): KnowledgePatch | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const topic = (typeof o.topic === 'string' ? o.topic : '').replace(/^\[id=[^\]]*\]\s*/i, '').trim().slice(0, 24);
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
    basis: typeof o.basis === 'string' ? o.basis.trim().slice(0, 240) : '',
    impact: typeof o.impact === 'string' ? o.impact.trim().slice(0, 240) : '',
    aliases: toStringArray(o.aliases, MAX_ALIASES, MAX_ALIAS_LEN),
    keywords: toStringArray(o.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN),
    event_time: toEventTime(o.event_time),
    status_explicit: o.status !== undefined && o.status !== null,
    source_explicit: o.source !== undefined && o.source !== null,
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
export function parseKnowledgeResponse(text: string): { baseRevision: number | null; patches: KnowledgePatch[] } | null {
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

/** 合并两个字符串数组：限条数与单条长度，同样丢弃句子式项——
 *  合并路径会绕过解析期归一化，不在这里挡就会把超长/判断式别名带进表里。 */
const mergeUnique = (a: string[], b: string[], max: number, maxLen: number): string[] => {
  const out = [...a];
  for (const item of b) {
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

  const findById = (id: string | undefined): KnowledgeReportEntry | undefined =>
    id ? work.find(e => e.id === id) : undefined;

  const findByTopic = (topic: string): KnowledgeReportEntry | undefined => {
    const key = normalizeTopic(topic);
    if (!key) return undefined;
    return work.find(e => normalizeTopic(e.topic) === key);
  };

  const findByAlias = (patch: KnowledgePatch): KnowledgeReportEntry | undefined => {
    const topics = [patch.topic, ...(patch.drop ? [] : patch.aliases)].map(normalizeTopic).filter(Boolean);
    if (!topics.length) return undefined;
    const hits = work.filter(e => {
      const own = [e.topic, ...e.aliases].map(normalizeTopic).filter(Boolean);
      return topics.some(t => own.includes(t));
    });
    // 别名命中多条时不猜：交给相似度/新建路径，避免把两条不同信息并成一条
    return hits.length === 1 ? hits[0] : undefined;
  };

  const findSimilar = (
    patch: KnowledgePatch,
  ): { entry: KnowledgeReportEntry; score: number; second: number; secondTopic: string } | null => {
    const topic = patch.topic;
    if (!topic) return null;
    // 只看 topic 太脆：「张子薇抽烟」「张子薇逃课」共享人名二元组，标题相似度高但实质不同。
    // 把补丁的别名与检索词一起纳入，取「任一侧说法对任一侧说法」的最大分——同一件事换个
    // 说法通常 topic 变了但 keywords/aliases 有交集，而不同的事即便共享人名也难同时命中
    // 多个检索词。阈值与领先幅度不变，收紧的是「什么算同一个说法」。
    const patchForms = [topic, ...(patch.drop ? [] : patch.aliases), ...(patch.drop ? [] : patch.keywords)]
      .map(normalizeTopic)
      .filter(Boolean);
    let best: KnowledgeReportEntry | null = null;
    let bestScore = 0;
    let secondScore = 0;
    let secondTopic = '';
    for (const e of work) {
      if (e.retired) continue;
      const entryForms = [e.topic, ...e.aliases, ...e.keywords].map(normalizeTopic).filter(Boolean);
      let score = 0;
      for (const a of patchForms) {
        for (const b of entryForms) {
          const s = textSimilarity(a, b);
          if (s > score) score = s;
        }
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
    let matchedBy = target ? (findById(patch.id) === target ? 'id' : findByTopic(patch.topic) === target ? 'topic' : 'alias') : '';

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
          change('drop_missing', { id: patch.id ?? '', topic: patch.topic }, '未找到对应条目，忽略删除', now, atMessage),
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
      if (beforeStatus !== target.status) {
        detailParts.push(STATUS_DETAIL(beforeStatus, target.status));
        // 只留一跳来路：面板据此标「由存疑转正」，完整历史仍在 last_changes
        target.previous_status = beforeStatus;
      }
      // 三态与获取方式交叉校验：不知道的信息不可能有获取方式；声称已知却没有获取过程时降级存疑
      if (target.status === 'unknown') target.source = 'none';
      else if (target.source === 'none' && target.status === 'known') target.status = 'uncertain';
      target.basis = patch.basis || target.basis;
      target.impact = patch.impact || target.impact;
      target.aliases = mergeUnique(target.aliases, patch.aliases ?? [], MAX_ALIASES, MAX_ALIAS_LEN);
      target.keywords = mergeUnique(target.keywords, patch.keywords ?? [], MAX_KEYWORDS, MAX_KEYWORD_LEN);
      // 时间只在模型给出时覆盖：旧值往往是更早、更接近事件发生时的判定
      if (patch.event_time) target.event_time = patch.event_time;
      target.updated_at_message = atMessage;
      target.revision += 1;
      const kind: KnowledgeChangeKind = wasRetired ? 'restored' : matchedBy === 'similarity' || matchedBy === 'alias' ? 'merged' : 'updated';
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
      aliases: [...(patch.aliases ?? [])],
      keywords: [...(patch.keywords ?? [])],
      status,
      source: status === 'unknown' ? 'none' : (patch.source ?? 'unspecified'),
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
    changes.push(change('added', entry, '新增条目', now, atMessage));
    mutated = true;
  }

  // 容量治理：先清退役条目（最久未更新优先），再清活跃条目（已知最先淘汰，锁定永不淘汰）
  const retired = work.filter(e => e.retired);
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
    // 淘汰优先级：已知（约束力最弱）→ 存疑 → 未知，同档内最久未更新优先；
    // 锁定条目永不淘汰。只淘汰到刚好回到上限，不按分档配额重排——
    // 按配额分档会先把 unknown 的新条目挤掉，与「未知优先保留」的注入口径相反。
    const need = active.length - MAX_STORED_ENTRIES;
    const evict = new Set<string>();
    for (const status of ['known', 'uncertain', 'unknown'] as KnowledgeStatus[]) {
      if (evict.size >= need) break;
      const group = active
        .filter(e => e.status === status && !e.locked)
        .sort((a, b) => a.updated_at_message - b.updated_at_message);
      for (const e of group) {
        if (evict.size >= need) break;
        evict.add(e.id);
      }
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
    if (!target.impact && src.impact) target.impact = src.impact;
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
 *  只列活跃条目；锁定标记必须让模型看见，否则它会反复尝试修改被拒。 */
export function renderExistingTable(entries: KnowledgeReportEntry[], revision = 0): string {
  const active = entries.filter(e => e.topic && !e.retired);
  if (!active.length) return '';
  const lines = active.map(e => {
    const tags = [
      `[id=${e.id || '?'}]`,
      `[${STATUS_LABEL[e.status]}]`,
      `[来源=${SOURCE_LABEL[e.source]}]`,
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
 *  为什么不用楼层数：编辑/删除/切分支都可能保持楼层数不变，必须看内容。 */
export function computeChatFingerprint(messages: Array<{ mes?: unknown; is_system?: boolean; is_user?: boolean; role?: string }>): string {
  const visible = messages.filter(m => !m.is_system);
  const tail = visible.slice(-12);
  const payload = tail
    .map(m => {
      const role = m.role ?? (m.is_user ? 'user' : 'assistant');
      const text = String(m.mes ?? '');
      return `${role}:${text.length}:${text.slice(0, 400)}`;
    })
    .join('\n');
  return `${visible.length}:${fnv1a(payload)}`;
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
        existing.basis = raw.basis || existing.basis;
        existing.impact = raw.impact || existing.impact;
        existing.updated_at_message = raw.updated_at_message;
      }
      changes.unshift(
        change('merged', existing, `旧报告重复主题「${topic}」已合并`, now, existing.updated_at_message),
      );
      continue;
    }
    const id = raw.id?.trim() || ensureUniqueId(makeEntryId(topic, raw.updated_at_message ?? 0), usedIds);
    usedIds.add(id);
    const entry: KnowledgeReportEntry = {
      ...raw,
      id,
      topic,
      aliases: toStringArray(raw.aliases, MAX_ALIASES, MAX_ALIAS_LEN),
      keywords: toStringArray(raw.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN),
      source: normalizeSource(raw.source),
      event_time: toEventTime(raw.event_time),
      first_seen_message: raw.first_seen_message || raw.updated_at_message || 0,
      updated_at_message: raw.updated_at_message || 0,
      revision: raw.revision || 0,
      locked: raw.locked === true,
      retired: raw.retired === true,
      retired_reason: raw.retired_reason || '',
    };
    // 旧档的 evidence_floors 必须显式删除：上面 ...raw 会原样带回来，
    // 而 zod strip 后 validateInplace 的 _.assign 又会把它合并回落盘对象，
    // 不删就会随聊天文件一直残留（同全局设置迁移块的约定）。
    delete (entry as Record<string, unknown>).evidence_floors;
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
