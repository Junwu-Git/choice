/**
 * 知识边界手动操作：新增 / 编辑 / 锁定 / 退役 / 恢复 / 清空。
 *
 * 为什么集中在一个模块：这些操作都要同时维护报告修订号、变更记录与条目字段，
 * 分散在组件里容易出现「改了内容没 bump revision」——在途分析结果就会覆盖用户刚改的表。
 * 直接改 store 里的报告对象，由 chat-settings 的 deep watch 负责落盘。
 *
 * 与 AI 合并的区别：用户是最终权威，锁定条目也允许手动编辑；手动操作不代表重新分析过
 * 聊天，因此 based_on_message / based_on_fingerprint 保持不变，只刷新 updated_at。
 */

import {
  findDuplicateGroups,
  isSentenceLike,
  makeEntryId,
  mergeDuplicateGroup,
  MAX_ALIASES,
  MAX_ALIAS_LEN,
  MAX_CHANGES,
  MAX_EVENT_TIME_LEN,
  MAX_KEYWORDS,
  MAX_KEYWORD_LEN,
} from '@/core/knowledge-report';
import type {
  KnowledgeChange,
  KnowledgeChangeKind,
  KnowledgeReportEntry,
  KnowledgeSource,
  KnowledgeStatus,
} from '@/type/settings';
import { useChatSettingsStore } from '@/store/chat-settings';

export type KnowledgeEntryInput = {
  topic: string;
  status: KnowledgeStatus;
  source: KnowledgeSource;
  aliases: string[];
  keywords: string[];
  basis: string;
  impact: string;
  event_time: string;
};

const normalizeList = (list: string[], max: number, maxLen: number): string[] => {
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.replace(/\s+/g, ' ').trim();
    // 与 AI 路径同口径（直接复用 isSentenceLike）：句子式条目（判断/描述/事件叙述）
    // 不是「叫法」，两条链路若各写一套，用户手填的内容会被 AI 下一轮判成脏数据。
    if (!s || isSentenceLike(s)) continue;
    const cut = s.slice(0, maxLen);
    if (out.includes(cut)) continue;
    out.push(cut);
    if (out.length >= max) break;
  }
  return out;
};

const normalizeEventTime = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_TIME_LEN);

function report() {
  return useChatSettingsStore().settings.knowledge_report;
}

function pushChange(
  kind: KnowledgeChangeKind,
  entry: Pick<KnowledgeReportEntry, 'id' | 'topic'>,
  detail: string,
): void {
  const r = report();
  const change: KnowledgeChange = {
    at: Date.now(),
    at_message: r.based_on_message,
    kind,
    id: entry.id,
    topic: entry.topic,
    detail,
  };
  r.last_changes = [change, ...r.last_changes].slice(0, MAX_CHANGES);
}

/** 每次手动改动都 bump 报告修订号：让在途分析结果被并发守卫丢弃，也便于面板显示版本。 */
function touch(): void {
  const r = report();
  r.updated_at = Date.now();
  r.revision += 1;
}

/** 新增手动条目，返回新条目 ID。topic 为空时拒绝（调用方应先校验）。 */
export function addManualEntry(input: KnowledgeEntryInput): string | null {
  const topic = input.topic.trim().slice(0, 24);
  if (!topic) return null;
  const r = report();
  const existingIds = new Set(r.entries.map(e => e.id));
  let id = makeEntryId(topic, r.based_on_message);
  let i = 2;
  while (existingIds.has(id)) id = `${makeEntryId(topic, r.based_on_message)}_${i++}`;
  const entry: KnowledgeReportEntry = {
    id,
    topic,
    aliases: normalizeList(input.aliases, MAX_ALIASES, MAX_ALIAS_LEN),
    keywords: normalizeList(input.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN),
    status: input.status,
    source: input.source,
    previous_status: '',
    basis: input.basis.trim().slice(0, 240),
    impact: input.impact.trim().slice(0, 240),
    event_time: normalizeEventTime(input.event_time),
    first_seen_message: r.based_on_message,
    updated_at_message: r.based_on_message,
    revision: 1,
    locked: false,
    retired: false,
    retired_reason: '',
  };
  if (entry.status === 'unknown') entry.source = 'none';
  else if (entry.source === 'none' && entry.status === 'known') entry.status = 'uncertain';
  r.entries = [...r.entries, entry];
  pushChange('added', entry, '手动新增');
  touch();
  return id;
}

/** 编辑条目（含锁定条目：用户是最终权威）。找不到 ID 返回 false。 */
export function updateManualEntry(id: string, input: KnowledgeEntryInput): boolean {
  const r = report();
  const entry = r.entries.find(e => e.id === id);
  if (!entry) return false;
  const topic = input.topic.trim().slice(0, 24);
  if (!topic) return false;
  const beforeStatus = entry.status;
  entry.topic = topic;
  entry.status = input.status;
  entry.source = input.source;
  entry.aliases = normalizeList(input.aliases, MAX_ALIASES, MAX_ALIAS_LEN);
  entry.keywords = normalizeList(input.keywords, MAX_KEYWORDS, MAX_KEYWORD_LEN);
  entry.basis = input.basis.trim().slice(0, 240);
  entry.impact = input.impact.trim().slice(0, 240);
  entry.event_time = normalizeEventTime(input.event_time);
  entry.revision += 1;
  if (entry.status === 'unknown') entry.source = 'none';
  else if (entry.source === 'none' && entry.status === 'known') entry.status = 'uncertain';
  if (beforeStatus !== entry.status) entry.previous_status = beforeStatus;
  pushChange(
    'updated',
    entry,
    beforeStatus === entry.status
      ? '手动编辑'
      : `状态 ${statusLabel(beforeStatus)} → ${statusLabel(entry.status)}（手动）`,
  );
  touch();
  return true;
}

/** 锁定/解锁：锁定后 AI 补丁完全跳过该条目（含改名绕过）。 */
export function setEntryLocked(id: string, locked: boolean): boolean {
  const r = report();
  const entry = r.entries.find(e => e.id === id);
  if (!entry || entry.locked === locked) return false;
  entry.locked = locked;
  entry.revision += 1;
  pushChange(locked ? 'locked' : 'unlocked', entry, locked ? '已锁定，AI 不再修改' : '已解锁');
  touch();
  return true;
}

/** 软删除：保留条目与 ID，AI 重新提出同主题时会按精确命中恢复。 */
export function retireEntry(id: string, reason = '手动退役'): boolean {
  const r = report();
  const entry = r.entries.find(e => e.id === id);
  if (!entry || entry.retired) return false;
  entry.retired = true;
  entry.retired_reason = reason;
  entry.revision += 1;
  pushChange('retired', entry, reason);
  touch();
  return true;
}

export function restoreEntry(id: string): boolean {
  const r = report();
  const entry = r.entries.find(e => e.id === id);
  if (!entry || !entry.retired) return false;
  entry.retired = false;
  entry.retired_reason = '';
  entry.revision += 1;
  pushChange('restored', entry, '手动恢复');
  touch();
  return true;
}

/** 清空报告：条目、变更记录与修订号全部归零（重建整表前的彻底重置）。
 *  当前 UI 不直接调用（重建走 analyzeKnowledgeBoundary(rebuild=true)），
 *  保留给后续「清空」入口与手动排障使用。 */
export function clearKnowledgeReport(): void {
  const r = report();
  r.entries = [];
  r.last_changes = [];
  r.revision = 0;
  r.based_on_message = 0;
  r.based_on_fingerprint = '';
  r.updated_at = Date.now();
}

/** 扫描当前报告的重复条目（只读，供 UI 预览要合并多少条）。 */
export function scanDuplicateEntries(): ReturnType<typeof findDuplicateGroups> {
  return findDuplicateGroups(report().entries);
}

/** 导入外部报告条目（同角色卡跨聊天复用、或从备份恢复）。
 *
 *  合并而非替换：导入的文件可能来自另一个聊天，直接替换会丢掉当前聊天独有的条目。
 *  同 id 或同 topic 的条目按「较新的 updated_at_message 胜出」覆盖，其余作为新条目追加；
 *  锁定状态沿用当前表（导入文件里的锁定不可信——那是别的聊天里用户做的决定）。
 *  返回 { added, updated } 计数，供 UI 汇报。 */
export function importKnowledgeEntries(incoming: KnowledgeReportEntry[]): { added: number; updated: number } {
  const r = report();
  const byId = new Map(r.entries.map(e => [e.id, e]));
  const byTopic = new Map(r.entries.filter(e => e.topic).map(e => [e.topic.trim(), e]));
  let added = 0;
  let updated = 0;
  const next = [...r.entries];

  for (const raw of incoming) {
    if (!raw.topic || raw.retired) continue;
    const hit = byId.get(raw.id) ?? byTopic.get(raw.topic.trim());
    if (hit) {
      // 只搬「知识内容」，不搬锁定/退役/修订号（当前聊天的用户意志优先）
      hit.status = raw.status;
      hit.source = raw.source;
      hit.basis = raw.basis || hit.basis;
      hit.impact = raw.impact || hit.impact;
      hit.event_time = raw.event_time || hit.event_time;
      hit.aliases = normalizeList([...hit.aliases, ...raw.aliases], MAX_ALIASES, MAX_ALIAS_LEN);
      hit.keywords = normalizeList([...hit.keywords, ...raw.keywords], MAX_KEYWORDS, MAX_KEYWORD_LEN);
      hit.revision += 1;
      updated += 1;
      continue;
    }
    const entry: KnowledgeReportEntry = {
      ...raw,
      // 重新分配 id：导入文件的 id 可能与本聊天已删条目的 id 撞车
      id: makeEntryId(raw.topic, r.based_on_message),
      first_seen_message: r.based_on_message,
      updated_at_message: r.based_on_message,
      revision: 1,
      previous_status: '',
      locked: false,
      retired: false,
      retired_reason: '',
    };
    const existingIds = new Set(next.map(e => e.id));
    let id = entry.id;
    let i = 2;
    while (existingIds.has(id)) id = `${entry.id}_${i++}`;
    entry.id = id;
    next.push(entry);
    added += 1;
  }

  if (added || updated) {
    r.entries = next;
    pushChange('merged', { id: '', topic: '' }, `导入报告：新增 ${added} 条，更新 ${updated} 条`);
    touch();
  }
  return { added, updated };
}

/** 执行手动整理：合并所有扫描到的重复组。
 *
 *  为什么不复用 AI 路径的阈值：AI 每次只处理本轮补丁，误并影响面小；手动整理一次改全表，
 *  误并会直接丢信息，故用更严的阈值（见 MANUAL_DEDUP_*）。
 *  锁定条目完全不参与——用户已明确表态，批量操作不能动。
 *  返回实际合并掉的条目数。 */
export function tidyKnowledgeReport(): number {
  const r = report();
  const groups = findDuplicateGroups(r.entries);
  if (!groups.length) return 0;
  let entries = r.entries;
  let mergedCount = 0;
  const changes: KnowledgeChange[] = [];
  for (const group of groups) {
    // 目标条目可能已被前面的组合并掉：此时组内 id 在 entries 里找不到，跳过即可。
    // 不能用「长度是否变化」判断——mergeDuplicateGroup 的跳过分支同样返回新数组。
    if (!entries.some(e => e.id === group.keep.id)) continue;
    const out = mergeDuplicateGroup(entries, group, r.based_on_message);
    entries = out.entries;
    mergedCount += group.merge.length;
    changes.push(out.change);
  }
  if (!mergedCount) return 0;
  r.entries = entries;
  r.last_changes = [...changes.reverse(), ...r.last_changes].slice(0, MAX_CHANGES);
  touch();
  return mergedCount;
}

function statusLabel(status: KnowledgeStatus): string {
  return status === 'known' ? '已知' : status === 'uncertain' ? '存疑' : '未知';
}
