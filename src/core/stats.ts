import { useGlobalSettingsStore } from '@/store/global-settings';
import { parseOptionType, parseOptionContent } from '@/util/option-format';
import type { ChoiceOption } from '@/core/options-store';
import type { StatsSettings } from '@/type/settings';

/** by_text 最大键数：超出后不再为「新文本」新增键（已有键照常累计），
 *  避免排行榜无限膨胀；配合统计页「清空统计」兜底。 */
export const MAX_TEXT_KEYS = 500;

/** 记录一轮行动选项生成成功（去重/补齐后实际保留的条数）。
 *  仅行动选项视图计入；在 generator.ts 的 generateOptions 成功路径调用，
 *  失败/取消/解析为空一律不调用。逐条池条目 id 不在此聚合——选项是 AI 自由
 *  生成文本，无法可靠归因到单条池条目，轮次级集合随 generation.poolEntryIds
 *  落消息 extra，供未来条目级统计使用。 */
export function recordOptionsGenerated(options: ChoiceOption[]): void {
  const stats = useGlobalSettingsStore().settings.stats;
  stats.total_generated += options.length;
  stats.updated_at = Date.now();
  const knownKeys = Object.keys(stats.by_text);
  for (const opt of options) {
    const type = parseOptionType(opt.text);
    const text = parseOptionContent(opt.text).trim();
    if (!text) continue;
    const entry = stats.by_text[text];
    if (entry) {
      entry.generated += 1;
      entry.type = type;
    } else if (knownKeys.length < MAX_TEXT_KEYS) {
      stats.by_text[text] = { generated: 1, selected: 0, type, last_selected_at: 0 };
      knownKeys.push(text);
    }
    const tyEntry = stats.by_type[type] ?? { generated: 0, selected: 0 };
    tyEntry.generated += 1;
    stats.by_type[type] = tyEntry;
  }
}

/** 记录用户点击应用一次行动选项。仅行动选项视图计入；调用方（option-action.ts）
 *  已按 view 过滤，润色视图不会走到这里。任意行为（insert/append/fill/send）
 *  各计 1 次。 */
export function recordOptionSelected(option: ChoiceOption): void {
  const stats = useGlobalSettingsStore().settings.stats;
  stats.total_selected += 1;
  stats.updated_at = Date.now();
  const type = parseOptionType(option.text);
  const text = parseOptionContent(option.text).trim();
  if (!text) return;
  const entry = stats.by_text[text];
  if (entry) {
    entry.selected += 1;
    entry.last_selected_at = Date.now();
  } else if (Object.keys(stats.by_text).length < MAX_TEXT_KEYS) {
    stats.by_text[text] = { generated: 0, selected: 1, type, last_selected_at: Date.now() };
  }
  const tyEntry = stats.by_type[type] ?? { generated: 0, selected: 0 };
  tyEntry.selected += 1;
  stats.by_type[type] = tyEntry;
}

/** 清空全部统计（总数、文本/类型聚合、时间戳一并重置）。统计页「清空统计」入口调用。 */
export function clearStats(): void {
  const gs = useGlobalSettingsStore();
  gs.settings.stats = {
    total_generated: 0,
    total_selected: 0,
    by_text: {},
    by_type: {},
    updated_at: Date.now(),
  };
}

export type TextRankRow = { text: string; type: string; generated: number; selected: number };
export type TypeRankRow = { type: string; generated: number; selected: number; rate: number | null };

/** 文本榜纯函数：按生成/选择次数降序取前 limit 条（排序逻辑单一真相源，组件只渲染） */
export function topTextEntries(stats: StatsSettings, by: 'generated' | 'selected', limit = 50): TextRankRow[] {
  return Object.entries(stats.by_text)
    .map(([text, e]) => ({ text, type: e.type, generated: e.generated, selected: e.selected }))
    .filter(r => (by === 'generated' ? r.generated > 0 : r.selected > 0))
    .sort((a, b) => b[by] - a[by] || a.text.localeCompare(b.text))
    .slice(0, limit);
}

/** 类型榜纯函数：按生成次数降序，附选择率（生成数为 0 时 rate 为 null） */
export function topTypeEntries(stats: StatsSettings, limit = 50): TypeRankRow[] {
  return Object.entries(stats.by_type)
    .map(([type, e]) => ({
      type: type || '（无类型）',
      generated: e.generated,
      selected: e.selected,
      rate: e.generated > 0 ? e.selected / e.generated : null,
    }))
    .filter(r => r.generated > 0)
    .sort((a, b) => b.generated - a.generated || a.type.localeCompare(b.type))
    .slice(0, limit);
}
