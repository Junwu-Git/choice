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
import { entrySortScore, escapePromptText, MAX_INJECT_ENTRIES, INJECT_CHAR_BUDGET } from '@/core/knowledge-report';
import type { KnowledgeReport, KnowledgeReportEntry, KnowledgeStatus } from '@/type/settings';

const STATUS_HEADER: Record<KnowledgeStatus, string> = {
  known: '【已知】可以正常作为行动依据',
  uncertain: '【存疑】只能写成试探、怀疑或求证，不得当作已确认的事实',
  unknown: '【未知】不得作为行动依据，只能通过可见钩子触发（看见异样、听见动静、被当面告知）',
};

/** 渲染分组顺序：已知 → 存疑 → 未知，未知放最后，模型读到时离任务指令最近，约束更强。
 *  注意这与「入选顺序」不是一回事——入选顺序见 renderKnowledgeInjectionDetailed 里的
 *  locked → unknown → uncertain → knownHit → knownRest（约束力强的先占预算）。 */
const STATUS_ORDER: KnowledgeStatus[] = ['known', 'uncertain', 'unknown'];

/** 锁定条目的组内优先级：约束力最强的未知先占预算（与入选顺序的注释一致）。
 *  渲染顺序仍用 STATUS_ORDER（known → uncertain → unknown），两者用途不同——
 *  前者决定「预算紧张时先保谁」，后者决定「模型读到的分组顺序」。 */
const LOCKED_STATUS_PRIORITY: Record<KnowledgeStatus, number> = { unknown: 0, uncertain: 1, known: 2 };

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
  /** 报告是否已落后于当前聊天：注入头部需要说明「这是上一次分析的结论」，
   *  否则模型会把旧结论当成当前事实（旧表里的 known 可能已被新剧情推翻）。 */
  stale?: boolean;
};

/** 本轮是否需要独立注入知识边界块。
 *
 *  合并模式（merge_with_generation）下不注入：合并任务自带同一张表并要求模型
 *  「先更新边界再生成」，再额外注入一份旧表会出现两份互相矛盾的结论
 *  （注入块说「必须遵守」，合并任务说「先改再写」），模型多半会沿用旧表。 */
export function shouldInjectKnowledge(injectEnabled: boolean, knowledgeMerge: boolean): boolean {
  return injectEnabled && !knowledgeMerge;
}

/** 单条渲染。已知项只带依据（约束力弱，省预算）；存疑/未知必须带约束，
 *  模型漏写时用固定兜底句，保证生成端拿到的是可执行指令。
 *  event_time 一并带上：模型据此判断「这条是三天前知道的还是刚刚知道的」，
 *  同一状态在不同时间点对行动的约束力不同（刚获知的信息更容易露馅）。
 *
 *  compact=true 是「降级形态」：只留主题一行。预算不够时给 known 用——
 *  主题本身已经陈述了事实（「富川家住高档住宅区」），依据对生成侧没有约束力。
 *  存疑/未知绝不可降级：它们的约束句就是唯一有价值的部分，省掉会变成误导。
 *  档位刻意不渲染：它是预算调度参数，写进注入只会引发元推理。 */
function formatLine(e: KnowledgeReportEntry, compact = false): string {
  if (compact) return `- ${escapePromptText(e.topic)}`;
  const parts: string[] = [];
  if (e.basis) parts.push(`依据：${escapePromptText(e.basis)}`);
  if (e.event_time) parts.push(`时间：${escapePromptText(e.event_time)}`);
  if (e.source === 'inferred' && e.status === 'known') parts.push('来源：推断（只能以推断口吻使用）');
  if (e.source === 'heard' && e.status === 'uncertain') parts.push('来源：传闻（未经证实）');
  if (e.status !== 'known') {
    // 约束语来自模型回传，必须转义：带换行会把一行拆成两行，带闭合标签能提前
    // 关掉注入块——与主题同源的提示词注入面
    parts.push(
      `约束：${escapePromptText(e.impact || (e.status === 'uncertain' ? '只能写成试探/怀疑' : '不得作为行动依据'))}`,
    );
  }
  return `- ${escapePromptText(e.topic)}${parts.length ? `｜${parts.join('；')}` : ''}`;
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
  return renderKnowledgeInjectionDetailed(report, opts).block;
}

/** 结构化结果：调试页据此显示「注入了哪些条目、哪些因预算被省略」。
 *  block 是模板文本（含 {{user}} 等宏），调用方负责 substituteParams。 */
export type KnowledgeInjectionResult = {
  block: string;
  chosen: KnowledgeReportEntry[];
  omitted: number;
  usedChars: number;
  total: number;
};

export function renderKnowledgeInjectionDetailed(
  report: KnowledgeReport,
  opts: RenderOptions = {},
): KnowledgeInjectionResult {
  const active = (report.entries ?? []).filter(e => !RETIRED_SKIP(e));
  if (!active.length) return { block: '', chosen: [], omitted: 0, usedChars: 0, total: 0 };

  const maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? MAX_INJECT_ENTRIES));
  const charBudget = Math.max(200, Math.floor(opts.charBudget ?? INJECT_CHAR_BUDGET));
  const sceneNorm = normalizeText(opts.sceneText ?? '');

  // 「最新楼层」以条目自报的 updated_at_message 为基准，不读聊天数组：
  // 本模块的入参只有报告与场景文本，注入逻辑必须保持纯函数。
  // 效果等价——报告里最大的 updated_at_message 就是最后一轮分析看到的楼层数。
  const latestMessage = active.reduce((max, e) => Math.max(max, e.updated_at_message), 0);

  const scored = active.map(e => ({ entry: e, hits: sceneHits(e, sceneNorm) }));
  // 命中数只算一次：下面配额判断还要用，重复调用会把每条检索词重新归一化/扫描一遍场景。
  const hitsById = new Map(scored.map(s => [s.entry.id, s.hits]));
  const byLockedStatus = (a: { entry: KnowledgeReportEntry }, b: { entry: KnowledgeReportEntry }) =>
    LOCKED_STATUS_PRIORITY[a.entry.status] - LOCKED_STATUS_PRIORITY[b.entry.status];
  // 组内排序：档位先验 + 新鲜度 + 场景命中。三者加性，任一项通胀都会被另两项摊平。
  const byScore = (
    a: { entry: KnowledgeReportEntry; hits: number },
    b: { entry: KnowledgeReportEntry; hits: number },
  ) =>
    entrySortScore(b.entry, latestMessage, b.hits) - entrySortScore(a.entry, latestMessage, a.hits) ||
    b.entry.updated_at_message - a.entry.updated_at_message;

  const locked = scored.filter(s => s.entry.locked).sort((a, b) => byLockedStatus(a, b) || byScore(a, b));
  const unknown = scored.filter(s => !s.entry.locked && s.entry.status === 'unknown').sort(byScore);
  const uncertain = scored.filter(s => !s.entry.locked && s.entry.status === 'uncertain').sort(byScore);
  const knownHit = scored
    .filter(s => !s.entry.locked && s.entry.status === 'known' && s.hits > 0)
    .sort((a, b) => byScore(a, b) || b.hits - a.hits);
  const knownRest = scored.filter(s => !s.entry.locked && s.entry.status === 'known' && s.hits === 0).sort(byScore);

  const ordered = [...locked, ...unknown, ...uncertain, ...knownHit, ...knownRest].map(s => s.entry);

  // 头部两行 + 分组标题 + 尾部省略说明的固定开销先扣掉：不扣会让实际注入超出用户设的预算
  // （每个分组标题约 30 字，三个分组就是 90 字，长聊里这部分不可忽略）
  const HEADER_RESERVE = 120;
  const bodyBudget = Math.max(0, charBudget - HEADER_RESERVE);

  // known 未命中场景的条目配额：只在「有场景文本」时生效。没有场景文本时所有 known 的
  // hits 都是 0，若仍按一半砍会把预算浪费掉；有场景文本时命中才是有效信号，
  // 让未命中的 known 最多占 known 配额一半，避免条目少于预算时全部入选、命中形同虚设。
  // 未知/存疑/锁定不受此限——它们是约束项，宁可多占预算。
  // 高权重的 known 豁免这条配额：它编码的是约束力而不是相关性，
  // 一条「漏了会越界」的已知项不该因为没在本场景命中就被砍掉。
  const restQuotaActive = sceneNorm.length > 0;
  const knownBudget = Math.max(1, Math.ceil((maxEntries - locked.length - unknown.length - uncertain.length) / 2));
  let knownTaken = 0;

  /** 降级记录：entry.id 集合，用于渲染时改用精简形态。 */
  const compactIds = new Set<string>();
  const chosen: KnowledgeReportEntry[] = [];
  let used = 0;
  let omitted = 0;
  for (const e of ordered) {
    // 条数上限是硬上限（设置里就叫「条数上限」），降级不能突破它——
    // 否则用户设 24 条却收到 60 条，预算形同虚设。
    if (chosen.length >= maxEntries) {
      omitted++;
      continue;
    }
    const isRest = restQuotaActive && e.status === 'known' && !e.locked && (hitsById.get(e.id) ?? 0) === 0;
    if (isRest && knownTaken >= knownBudget && e.importance !== 'high') {
      omitted++;
      continue;
    }
    const fullLen = formatLine(e).length + 1;
    if (used + fullLen <= bodyBudget) {
      used += fullLen;
      chosen.push(e);
      if (isRest) knownTaken++;
      continue;
    }
    // 字符预算放不下完整形态时，known 退化成主题单行——主题本身已陈述事实，
    // 依据对生成侧没有约束力。存疑/未知/锁定不可降级：约束句是它们的全部价值，
    // 省掉会变成「模型以为可以随便用」的误导。
    if (e.status === 'known' && !e.locked) {
      const compactLen = formatLine(e, true).length + 1;
      if (used + compactLen <= bodyBudget) {
        used += compactLen;
        compactIds.add(e.id);
        chosen.push(e);
        if (isRest) knownTaken++;
        continue;
      }
    }
    omitted++;
  }
  if (!chosen.length) {
    // 一条都放不下时不能静默返回空：模型会以为没有知识边界约束，反而更容易写出
    // 全知候选。只发头部与省略数量，不泄漏任何条目内容。
    const block = [
      '<knowledge_boundary_report>',
      '以下是针对 {{user}}（仅玩家角色本人）的知识边界分析，生成候选时必须遵守：',
      ...staleNotice(opts.stale),
      `（共 ${active.length} 项，本次因篇幅限制未注入具体条目；仍须遵守「不知道的信息不得作为行动依据」）`,
      '</knowledge_boundary_report>',
    ].join('\n');
    return { block, chosen, omitted, usedChars: 0, total: active.length };
  }

  // 分组渲染保持状态组顺序；组内沿用 chosen 的既有次序（已按分数排好），
  // 精简标记按 id 查表，保证渲染形态与预算计算时一致。
  const sections: string[] = [];
  for (const status of STATUS_ORDER) {
    const lines = chosen.filter(e => e.status === status).map(e => formatLine(e, compactIds.has(e.id)));
    if (lines.length) sections.push(`${STATUS_HEADER[status]}\n${lines.join('\n')}`);
  }

  const total = active.length;
  const block = [
    '<knowledge_boundary_report>',
    '以下是针对 {{user}}（仅玩家角色本人）的知识边界分析，生成候选时必须遵守：',
    ...staleNotice(opts.stale),
    ...sections,
    total > chosen.length ? `（共 ${total} 项，另有 ${omitted} 项未注入）` : '',
    '</knowledge_boundary_report>',
  ]
    .filter(Boolean)
    .join('\n');
  return { block, chosen, omitted, usedChars: used, total };
}

/** 报告过期时的提示行：说明这是上一次分析的结论，与当前场景冲突时以当前场景为准。
 *  过期报告仍然注入——unknown/uncertain 是必要安全约束，不能因为「可能不准」就丢掉。 */
function staleNotice(stale: boolean | undefined): string[] {
  if (!stale) return [];
  return ['（以下为上一次分析的结论；若与当前场景已发生的事实冲突，以当前场景为准）'];
}

/** 把注入块插到任务消息之前：选项任务的 user 消息承担最终指令，报告作为
 *  system 参考块紧邻其前，既不被历史冲淡也不打断任务指令的完整性。
 *
 *  anchor = 任务消息（option_task / 预设任务 user）。没有锚点时不再回退到
 *  「最后一条 user」——那条 user 往往是聊天历史里的用户发言，插进去会让约束
 *  夹在对话中间，模型可能当成对话内容；此时直接追加到末尾。 */
export function injectKnowledgeBlock(messages: ChatMsg[], block: string, anchor?: ChatMsg | null): void {
  if (!block) return;
  const entry: ChatMsg = { role: 'system', content: block };
  if (anchor) {
    const idx = messages.indexOf(anchor);
    if (idx >= 0) {
      messages.splice(idx, 0, entry);
      return;
    }
  }
  messages.push(entry);
}
