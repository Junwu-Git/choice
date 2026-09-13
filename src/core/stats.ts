import { useGlobalSettingsStore } from '@/store/global-settings';
import type { ChoiceOption } from '@/core/options-store';
import type { PoolEntry, StatsSettings } from '@/type/settings';

/** 取条目统计记录：不存在则创建（by_entry 只增，键数受用户实际使用过的条目数约束） */
const getEntryStats = (stats: StatsSettings, entryId: string) => {
  const e = stats.by_entry[entryId];
  if (e) return e;
  const fresh = { rounds_included: 0, rounds_with_selection: 0, last_selected_at: 0 };
  stats.by_entry[entryId] = fresh;
  return fresh;
};

/** 记录一轮行动选项生成成功（去重/补齐后实际保留条数）。仅行动选项视图计入。
 *  poolEntryIds 为该轮实际抽取的条目 id 集合——轮次共现归因：每个参与条目
 *  rounds_included +1。选项是 AI 自由文本，无选项→条目精确映射，整轮归因见
 *  generation.poolEntryIds；精确归因是后续生成契约升级方向。 */
export function recordOptionsGenerated(options: ChoiceOption[], poolEntryIds: string[]): void {
  const stats = useGlobalSettingsStore().settings.stats;
  stats.total_generated += options.length;
  stats.updated_at = Date.now();
  for (const id of poolEntryIds) {
    const e = getEntryStats(stats, id);
    e.rounds_included += 1;
  }
}

/** 记录用户点击应用一次行动选项（仅行动选项视图；调用方已按 view 过滤）。
 *  poolEntryIds 为被点选项所在轮的条目集合——整轮共现：每个参与条目命中轮次 +1。
 *  generationId 用于同代去重：同一轮连点多个选项只计 1 次命中（总量 total_selected
 *  仍每次 +1）；缺省（历史数据无上下文）时视为新命中。 */
export function recordOptionSelected(poolEntryIds: string[], generationId?: string): void {
  const stats = useGlobalSettingsStore().settings.stats;
  stats.total_selected += 1;
  stats.updated_at = Date.now();
  if (poolEntryIds.length === 0) return;
  if (generationId && generationId === stats.last_hit_generation_id) return;
  const now = Date.now();
  for (const id of poolEntryIds) {
    const e = getEntryStats(stats, id);
    e.rounds_with_selection += 1;
    e.last_selected_at = now;
  }
  stats.last_hit_generation_id = generationId ?? null;
}

/** 清空全部统计（总数、条目聚合、代去重记录、时间戳一并重置）。统计页「清空统计」入口调用。 */
export function clearStats(): void {
  const gs = useGlobalSettingsStore();
  gs.settings.stats = {
    total_generated: 0,
    total_selected: 0,
    by_entry: {},
    last_hit_generation_id: null,
    updated_at: Date.now(),
  };
}

export type EntryRankRow = {
  entryId: string;
  deleted: boolean;
  type: string;
  category: string;
  content: string;
  rounds_included: number;
  rounds_with_selection: number;
  rate: number | null;
};

export type EntryGroup = {
  /** 组名（空 category 归「未分组」；已删除条目组为「已删除」） */
  category: string;
  deletedGroup: boolean;
  /** 组内条目（全量含 0 参与，按参与轮次降序、未参与排后） */
  rows: EntryRankRow[];
  /** 组汇总（参与轮次合计） */
  rounds_included: number;
  rounds_with_selection: number;
  rate: number | null;
};

/** 条目榜分组纯函数：按 category 分组的折叠列表数据源。
 *  组顺序：groupOrder（条目库分组顺序）优先 → 未列入的自定义/未分组按名称 → 已删除组末尾。
 *  组内排序：参与轮次降序 → 命中轮次降序 → entryId。排序/分组逻辑单一真相源，组件只渲染 */
export function entryGroups(stats: StatsSettings, masterPool: PoolEntry[], groupOrder: string[]): EntryGroup[] {
  const poolMap = new Map(masterPool.map(e => [e.id, e]));
  const byCat = new Map<string, EntryRankRow[]>();
  const deletedRows: EntryRankRow[] = [];
  const rowFor = (entryId: string, entry: PoolEntry | undefined): EntryRankRow => {
    const e = stats.by_entry[entryId];
    return {
      entryId,
      deleted: !entry,
      type: entry?.type ?? '',
      category: entry?.category ?? '',
      content: entry?.content ?? '',
      rounds_included: e?.rounds_included ?? 0,
      rounds_with_selection: e?.rounds_with_selection ?? 0,
      rate: e && e.rounds_included > 0 ? e.rounds_with_selection / e.rounds_included : null,
    };
  };
  for (const entry of masterPool) {
    const cat = entry.category.trim() || '未分组';
    const list = byCat.get(cat) ?? [];
    list.push(rowFor(entry.id, entry));
    byCat.set(cat, list);
  }
  for (const [entryId] of Object.entries(stats.by_entry)) {
    if (!poolMap.has(entryId)) deletedRows.push(rowFor(entryId, undefined));
  }
  const makeGroup = (category: string, deletedGroup: boolean, rows: EntryRankRow[]): EntryGroup => {
    const rounds_included = rows.reduce((s, r) => s + r.rounds_included, 0);
    const rounds_with_selection = rows.reduce((s, r) => s + r.rounds_with_selection, 0);
    return {
      category,
      deletedGroup,
      rows: rows.sort(
        (a, b) =>
          b.rounds_included - a.rounds_included ||
          b.rounds_with_selection - a.rounds_with_selection ||
          a.entryId.localeCompare(b.entryId),
      ),
      rounds_included,
      rounds_with_selection,
      rate: rounds_included > 0 ? rounds_with_selection / rounds_included : null,
    };
  };
  const groups: EntryGroup[] = [];
  const used = new Set<string>();
  for (const cat of groupOrder) {
    const rows = byCat.get(cat);
    if (rows) {
      groups.push(makeGroup(cat, false, rows));
      used.add(cat);
    }
  }
  const rest = [...byCat.keys()].filter(cat => !used.has(cat)).sort((a, b) => a.localeCompare(b));
  for (const cat of rest) {
    groups.push(makeGroup(cat, false, byCat.get(cat)!));
  }
  if (deletedRows.length) {
    groups.push(makeGroup('已删除', true, deletedRows));
  }
  return groups;
}

export type TypeRankRow = {
  type: string;
  rounds_included: number;
  rounds_with_selection: number;
  rate: number | null;
};

/** 类型榜纯函数：由参与了至少一轮的条目统计按条目 type 聚合推导（不落盘，避免双写漂移）；
 *  已删除条目（无类型可查）归入「（已删除）」桶 */
export function typeLeaderboard(stats: StatsSettings, masterPool: PoolEntry[]): TypeRankRow[] {
  const poolMap = new Map(masterPool.map(e => [e.id, e]));
  const agg = new Map<string, TypeRankRow>();
  for (const [entryId, e] of Object.entries(stats.by_entry)) {
    if (e.rounds_included <= 0) continue;
    const entry = poolMap.get(entryId);
    const type = entry ? entry.type : '（已删除）';
    const row = agg.get(type) ?? {
      type,
      rounds_included: 0,
      rounds_with_selection: 0,
      rate: null,
    };
    row.rounds_included += e.rounds_included;
    row.rounds_with_selection += e.rounds_with_selection;
    row.rate = row.rounds_included > 0 ? row.rounds_with_selection / row.rounds_included : null;
    agg.set(type, row);
  }
  return [...agg.values()].sort(
    (a, b) =>
      b.rounds_included - a.rounds_included ||
      b.rounds_with_selection - a.rounds_with_selection ||
      a.type.localeCompare(b.type),
  );
}
