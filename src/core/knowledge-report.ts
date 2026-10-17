/**
 * 知识边界报告的纯函数层：模型输出 → 增量补丁 → 合并后的表 → 注入文本。
 *
 * 为什么是增量而不是每次全量重写：报告随聊天长期存在，全量重写会让模型每轮重新输出
 * 整张表（token 随表变大线性增长），且早期条目滚出上下文窗口后会被静默丢掉。
 * 改为「只读新增对话、只输出变化」，表是累积的记忆，请求只随增量增长。
 *
 * 与 knowledge-analysis.ts（发请求、写 store）刻意分离：本模块零酒馆运行时依赖，
 * 解析/合并/注入预算这类易出错的逻辑必须能被 vitest 直接覆盖（同 option-parse.ts 的动机）。
 */

import { STRIP_REASONING_TAGS_RE, stripTrailingCommas } from '@/core/option-parse';
import type { ChatMsg } from '@/core/api-client';
import type { KnowledgeReport, KnowledgeReportEntry, KnowledgeStatus } from '@/type/settings';

/** 单次解析上限：模型偶尔会把同一信息拆成十几行，超过这个量级注入文本会反客为主。 */
const MAX_PARSED_ENTRIES = 40;

/** 表格存储上限：增量更新只增不减，必须有一个硬上限防长聊无限膨胀。
 *  超出时丢最久未被更新的条目（`updated_at_message` 最小），而不是丢最新的。 */
export const MAX_STORED_ENTRIES = 60;

/** 注入条目总数上限（不分状态）。存疑/未知天然比已知少，故超限时按
 *  「未知 > 存疑 > 已知」的优先级保留——已知只是可依赖的信息，约束力最弱。 */
export const MAX_INJECT_ENTRIES = 24;

/** 注入文本总字符预算：选项生成的上下文里已有世界书/角色卡/历史，报告只是约束补充。
 *  与条数上限同时生效，先按条数选、再按字符预算裁。 */
const INJECT_CHAR_BUDGET = 2500;

const STATUS_ORDER: KnowledgeStatus[] = ['known', 'uncertain', 'unknown'];
/** 注入裁剪优先级：越靠前越先保住（未知/存疑才是防全知的关键约束）。 */
const PRIORITY_ORDER: KnowledgeStatus[] = ['unknown', 'uncertain', 'known'];

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  known: '已知',
  uncertain: '存疑',
  unknown: '未知',
};

const STATUS_HEADER: Record<KnowledgeStatus, string> = {
  known: '【已知】可以依赖',
  uncertain: '【存疑】只能写成因怀疑/听说/试探而行动，不得当作既定事实',
  unknown: '【未知】不得作为行动依据，不得对视线外/未被告知的事物行动',
};

const isStatus = (v: unknown): v is KnowledgeStatus => v === 'known' || v === 'uncertain' || v === 'unknown';

/** 增量补丁：drop=true 删除该 topic；否则按 topic 覆盖/新增。 */
export type KnowledgePatch =
  | { topic: string; drop: true }
  | { topic: string; drop?: false; status: KnowledgeStatus; basis: string; impact: string };

/** 宽松取单行字段：非对象返回 null；topic 为空整行丢弃（没有主题的行无法被候选引用）。 */
function pickEntry(x: unknown): KnowledgeReportEntry | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const topic = typeof o.topic === 'string' ? o.topic.trim() : '';
  if (!topic) return null;
  return {
    topic,
    // 状态非法一律按 unknown：从严兜底，宁可少给候选一条依据也不放行全知
    status: isStatus(o.status) ? o.status : 'unknown',
    basis: typeof o.basis === 'string' ? o.basis.trim() : '',
    impact: typeof o.impact === 'string' ? o.impact.trim() : '',
    updated_at_message: 0,
  };
}

/** 解析单条补丁：drop=true 时其余字段忽略。 */
function pickPatch(x: unknown): KnowledgePatch | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const topic = typeof o.topic === 'string' ? o.topic.trim() : '';
  if (!topic) return null;
  if (o.drop === true) return { topic, drop: true };
  const entry = pickEntry(x);
  if (!entry) return null;
  return { topic: entry.topic, status: entry.status, basis: entry.basis, impact: entry.impact };
}

/** 从模型输出里抽出 JSON 数组：主路径 + 截断抢救（流式代理可能在数组中途掐断）。 */
function extractArray(text: string): unknown[] | null {
  let c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();
  // 去代码块包裹（模型常把 JSON 包在 ```json 里）
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const arrStart = c.indexOf('[');
  if (arrStart === -1) return null;

  const arrEnd = c.lastIndexOf(']');
  if (arrEnd > arrStart) {
    try {
      const parsed = JSON.parse(stripTrailingCommas(c.slice(arrStart, arrEnd + 1)));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* 非合法 JSON，走截断抢救 */
    }
  }

  // 截断抢救：找字符串感知的最后一个完整 '}' 补 ']' 再解析——能救回多少算多少
  let lastBrace = -1;
  let inStr = false;
  let esc = false;
  for (let i = arrStart; i < c.length; i++) {
    const ch = c[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '}') lastBrace = i;
  }
  if (lastBrace > arrStart) {
    try {
      const parsed = JSON.parse(stripTrailingCommas(c.slice(arrStart, lastBrace + 1) + ']'));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* 抢救失败 */
    }
  }
  return null;
}

/** 解析增量补丁。同 topic 后出现的覆盖先出现的（模型可能先 upsert 再 drop）。
 *  返回 null = 模型输出里根本没有可解析的 JSON 数组（调用方应提示重试）；
 *  返回 [] = 解析成功但没有条目（明确的「本轮无变化」，是合法结果）。 */
export function parseKnowledgePatch(text: string): KnowledgePatch[] | null {
  const arr = extractArray(text);
  if (!arr) return null;
  // Map 的键序 = 首次出现位置，set 已有键不会改变位置——保留自然阅读顺序
  const byTopic = new Map<string, KnowledgePatch>();
  for (const x of arr) {
    const patch = pickPatch(x);
    if (!patch) continue;
    byTopic.set(patch.topic, patch);
    if (byTopic.size >= MAX_PARSED_ENTRIES) break;
  }
  return [...byTopic.values()];
}

/** 解析完整表格（忽略 drop）：首次分析/整表重建时用，也便于单测直接断言条目形态。 */
export function parseKnowledgeReport(text: string): KnowledgeReportEntry[] {
  const patch = parseKnowledgePatch(text);
  if (!patch) return [];
  return patch
    .filter((p): p is Extract<KnowledgePatch, { drop?: false }> => !p.drop)
    .map(p => ({ topic: p.topic, status: p.status, basis: p.basis, impact: p.impact, updated_at_message: 0 }));
}

/** 把补丁合并进已有表：同 topic 覆盖并刷新 updated_at_message，drop 删除，新 topic 追加。
 *  未触碰的条目保持原位置与原时间戳——它们仍是有效记忆，只是本轮没有变化。 */
export function mergeKnowledgePatch(
  existing: KnowledgeReportEntry[],
  patch: KnowledgePatch[],
  atMessage: number,
): KnowledgeReportEntry[] {
  const byTopic = new Map(existing.map(e => [e.topic, e]));
  for (const p of patch) {
    if (p.drop) {
      byTopic.delete(p.topic);
      continue;
    }
    byTopic.set(p.topic, {
      topic: p.topic,
      status: p.status,
      basis: p.basis,
      impact: p.impact,
      updated_at_message: atMessage,
    });
  }
  const out = [...byTopic.values()];
  if (out.length <= MAX_STORED_ENTRIES) return out;
  // 超上限：保留最近被更新的条目，丢弃最久没被碰过的（含首次分析时同为 0 的旧条目）
  const keep = new Set(
    [...out].sort((a, b) => b.updated_at_message - a.updated_at_message).slice(0, MAX_STORED_ENTRIES),
  );
  return out.filter(e => keep.has(e));
}

/** 渲染「已有知识边界表」块，作为增量分析的输入。空表返回 ''。 */
export function renderExistingTable(entries: KnowledgeReportEntry[]): string {
  const valid = entries.filter(e => e.topic);
  if (!valid.length) return '';
  return valid
    .map(e => {
      const tail = [e.basis ? `依据：${e.basis}` : '', e.impact ? `约束：${e.impact}` : ''].filter(Boolean).join('；');
      return `- [${STATUS_LABEL[e.status]}] ${e.topic}${tail ? `｜${tail}` : ''}`;
    })
    .join('\n');
}

const formatLine = (e: KnowledgeReportEntry): string => {
  // 已知项只需出处；存疑/未知需要约束，否则生成端拿到的是无法执行的信息
  const tail =
    e.status === 'known'
      ? e.basis
        ? `依据：${e.basis}`
        : ''
      : [e.basis ? `依据：${e.basis}` : '', e.impact ? `约束：${e.impact}` : ''].filter(Boolean).join('；');
  return `- ${e.topic}${tail ? `｜${tail}` : ''}`;
};

/** 把报告渲染成注入块。空报告返回 ''（调用方据此跳过注入，未分析过时零变化）。
 *  先按总数封顶（未知 > 存疑 > 已知），再按字符预算裁，最后按「已知→存疑→未知」分组渲染
 *  ——未知放最后，模型读到时离任务指令最近，约束更强。 */
export function renderKnowledgeInjection(report: KnowledgeReport): string {
  const valid = report.entries.filter(e => e.topic);
  if (!valid.length) return '';

  // 1) 条数上限：按优先级分配名额，已知最先被裁（它约束力最弱）
  const selected = new Set<KnowledgeReportEntry>();
  let remaining = MAX_INJECT_ENTRIES;
  let omitted = 0;
  for (const status of PRIORITY_ORDER) {
    const group = valid.filter(e => e.status === status);
    const take = group.slice(0, Math.max(0, remaining));
    for (const e of take) selected.add(e);
    remaining -= take.length;
    omitted += group.length - take.length;
  }

  // 2) 字符预算：同样按优先级扣，避免已知项先吃掉预算把未知挤掉
  const budgeted = new Set<KnowledgeReportEntry>();
  let used = 0;
  for (const status of PRIORITY_ORDER) {
    for (const e of valid) {
      if (e.status !== status || !selected.has(e)) continue;
      const len = formatLine(e).length;
      if (used + len > INJECT_CHAR_BUDGET) {
        omitted++;
        continue;
      }
      used += len + 1;
      budgeted.add(e);
    }
  }

  // 3) 渲染：组内保持表内顺序
  const sections: string[] = [];
  for (const status of STATUS_ORDER) {
    const lines = valid.filter(e => e.status === status && budgeted.has(e)).map(formatLine);
    if (lines.length) sections.push(`${STATUS_HEADER[status]}\n${lines.join('\n')}`);
  }
  if (!sections.length) return '';

  return [
    '<knowledge_boundary_report>',
    '以下是针对 {{user}}（仅玩家角色本人）的知识边界分析，生成候选时必须遵守（存疑项只能写成试探/怀疑，未知项不得作为依据）：',
    ...sections,
    omitted > 0 ? `（另有 ${omitted} 项因篇幅省略）` : '',
    '</knowledge_boundary_report>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 把注入块插到最后一条 user 消息之前：选项任务的 user 消息承担最终指令，报告作为
 *  system 参考块紧邻其前，既不被历史冲淡也不打断任务指令的完整性。
 *  没有 user 消息时追加到末尾（润色链路等异常形态下的兜底）。 */
export function injectKnowledgeBlock(messages: ChatMsg[], block: string): void {
  if (!block) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      messages.splice(i, 0, { role: 'system', content: block });
      return;
    }
  }
  messages.push({ role: 'system', content: block });
}
