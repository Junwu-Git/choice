/**
 * 知识边界报告注入：把「已知 / 存疑 / 未知」表筛选、裁剪、渲染成选项生成请求里的 system 块。
 *
 * 为什么按场景筛选：报告是长聊累积的记忆，条目会越来越多；全量塞进去会让无关条目吃掉
 * 上下文预算，模型还容易把远处剧情里的信息当成当前场景已知。每轮只挑与最近几条消息
 * 相关的条目，再按「未知/存疑/锁定」优先补齐——约束力最强的部分必须稳定在场。
 *
 * 为什么与 knowledge-report.ts 分开：报告模块是纯账本（解析/合并/迁移），本模块需要读
 * 聊天数组与设置，属于运行时装配；分开后账本逻辑仍可被单测直接覆盖。
 */

import type { ChatMsg } from '@/core/api-client';
import { normalizeText } from '@/core/text-similarity';
import { MAX_INJECT_ENTRIES, INJECT_CHAR_BUDGET } from '@/core/knowledge-report';
import type { KnowledgeReport, KnowledgeReportEntry, KnowledgeStatus } from '@/type/settings';

const STATUS_HEADER: Record<KnowledgeStatus, string> = {
  known: '【已知】可以正常作为行动依据',
  uncertain: '【存疑】只能写成试探、怀疑或求证，不得当作已确认的事实',
  unknown: '【未知】不得作为行动依据，只能通过可见钩子触发（看见异样、听见动静、被当面告知）',
};

/** 渲染分组顺序：未知放最后，模型读到时离任务指令最近，约束更强。 */
const STATUS_ORDER: KnowledgeStatus[] = ['known', 'uncertain', 'unknown'];

const RETIRED_SKIP = (e: KnowledgeReportEntry): boolean => e.retired || !e.topic;

/** 从聊天数组拼当前场景文本：只取最后几条可见消息，去掉思考块与 HTML 注释。
 *  不用完整构建后的 messages——那里面混着任务指令与条目池文本，会把关键词命中带偏。
 *  入参放宽为只要求 is_system（聊天数组的 ST 原生类型与 TavernHelper 子集都可传）。 */
export function buildSceneText(messages: ReadonlyArray<{ is_system?: boolean; mes?: unknown }>, window = 4): string {
  const visible = messages.filter(m => !m.is_system).slice(-Math.max(1, window));
  return visible
    .map(m =>
      String(m.mes ?? '')
        .replace(/<(?:think(?:ing)?|reasoning|thought)>[\s\S]*?<\/(?:think(?:ing)?|reasoning|thought)>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .slice(0, 2000),
    )
    .join('\n');
}

/** 条目检索词：topic + 别名 + 关键词，归一化后过滤过短项（单字命中噪音太大）。 */
function entryTerms(e: KnowledgeReportEntry): string[] {
  return [...new Set([e.topic, ...e.aliases, ...e.keywords].map(normalizeText))].filter(t => t.length >= 2);
}

/** 场景命中数：检索词在场景文本里出现的个数。 */
export function sceneHits(entry: KnowledgeReportEntry, sceneNorm: string): number {
  if (!sceneNorm) return 0;
  return entryTerms(entry).filter(t => sceneNorm.includes(t)).length;
}

type RenderOptions = {
  sceneText?: string;
  maxEntries?: number;
  charBudget?: number;
};

/** 单条渲染。已知项只带依据（约束力弱，省预算）；存疑/未知必须带约束，
 *  模型漏写时用固定兜底句，保证生成端拿到的是可执行指令。 */
function formatLine(e: KnowledgeReportEntry): string {
  const parts: string[] = [];
  if (e.basis) parts.push(`依据：${e.basis}`);
  if (e.source === 'inferred' && e.status === 'known') parts.push('来源：推断（只能以推断口吻使用）');
  if (e.source === 'heard' && e.status === 'uncertain') parts.push('来源：传闻（未经证实）');
  if (e.status !== 'known') {
    parts.push(`约束：${e.impact || (e.status === 'uncertain' ? '只能写成试探/怀疑' : '不得作为行动依据')}`);
  }
  return `- ${e.topic}${parts.length ? `｜${parts.join('；')}` : ''}`;
}

/**
 * 渲染注入块。空报告返回 ''（调用方据此跳过注入，从未分析过时零变化）。
 *
 * 选择顺序（约束力从强到弱）：
 *   1. 锁定条目（unknown → uncertain → known）
 *   2. unknown
 *   3. uncertain
 *   4. known 且场景命中
 *   5. known 且未命中（按最近更新补齐）
 * 条数与字符双预算逐条扣；超预算的条目跳过但继续尝试后续较短条目（不因一条长文本
 * 就浪费剩余预算），省略数量在尾部标注。
 */
export function renderKnowledgeInjection(report: KnowledgeReport, opts: RenderOptions = {}): string {
  const active = (report.entries ?? []).filter(e => !RETIRED_SKIP(e));
  if (!active.length) return '';

  const maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? MAX_INJECT_ENTRIES));
  const charBudget = Math.max(200, Math.floor(opts.charBudget ?? INJECT_CHAR_BUDGET));
  const sceneNorm = normalizeText(opts.sceneText ?? '');

  const scored = active.map(e => ({ entry: e, hits: sceneHits(e, sceneNorm) }));
  const byRecency = (a: { entry: KnowledgeReportEntry }, b: { entry: KnowledgeReportEntry }) =>
    b.entry.updated_at_message - a.entry.updated_at_message;
  const byStatus = (a: { entry: KnowledgeReportEntry }, b: { entry: KnowledgeReportEntry }) =>
    STATUS_ORDER.indexOf(a.entry.status) - STATUS_ORDER.indexOf(b.entry.status);

  const locked = scored.filter(s => s.entry.locked).sort((a, b) => byStatus(a, b) || byRecency(a, b));
  const unknown = scored.filter(s => !s.entry.locked && s.entry.status === 'unknown').sort(byRecency);
  const uncertain = scored.filter(s => !s.entry.locked && s.entry.status === 'uncertain').sort(byRecency);
  const knownHit = scored
    .filter(s => !s.entry.locked && s.entry.status === 'known' && s.hits > 0)
    .sort((a, b) => b.hits - a.hits || byRecency(a, b));
  const knownRest = scored.filter(s => !s.entry.locked && s.entry.status === 'known' && s.hits === 0).sort(byRecency);

  const ordered = [...locked, ...unknown, ...uncertain, ...knownHit, ...knownRest].map(s => s.entry);

  const chosen: KnowledgeReportEntry[] = [];
  let used = 0;
  let omitted = 0;
  for (const e of ordered) {
    if (chosen.length >= maxEntries) {
      omitted++;
      continue;
    }
    const len = formatLine(e).length + 1;
    if (used + len > charBudget) {
      omitted++;
      continue;
    }
    used += len;
    chosen.push(e);
  }
  if (!chosen.length) return '';

  const sections: string[] = [];
  for (const status of STATUS_ORDER) {
    const lines = chosen.filter(e => e.status === status).map(formatLine);
    if (lines.length) sections.push(`${STATUS_HEADER[status]}\n${lines.join('\n')}`);
  }

  const total = active.length;
  return [
    '<knowledge_boundary_report>',
    '以下是针对 {{user}}（仅玩家角色本人）的知识边界分析，生成候选时必须遵守：',
    ...sections,
    total > chosen.length ? `（共 ${total} 项，另有 ${omitted} 项因篇幅省略）` : '',
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
