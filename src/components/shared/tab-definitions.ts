export type TabId = 'pool' | 'generation' | 'prompt' | 'api' | 'worldinfo' | 'filter' | 'appearance' | 'debug';

interface TabDefinition {
  id: TabId;
  label: string;
  icon: string;
}

export const FLOATING_TABS: TabDefinition[] = [
  { id: 'pool', label: '条目池', icon: 'fa-solid fa-layer-group' },
  { id: 'generation', label: '生成', icon: 'fa-solid fa-bolt' },
  { id: 'prompt', label: '提示词', icon: 'fa-solid fa-align-left' },
  { id: 'api', label: 'API', icon: 'fa-solid fa-plug' },
  { id: 'worldinfo', label: '世界书', icon: 'fa-solid fa-book' },
  { id: 'filter', label: '过滤', icon: 'fa-solid fa-filter' },
  { id: 'appearance', label: '外观', icon: 'fa-solid fa-palette' },
  { id: 'debug', label: '调试', icon: 'fa-solid fa-gear' },
];

// 高级功能分层（advanced_features_enabled 开关）下的基础/高级 tab 划分：
// 基础档=非 ADVANCED_TAB_IDS（api 属首配必经路径必须留在基础层）；引导章节的进阶判定
// （guide-content 的 isAdvancedChapter）复用 ADVANCED_TAB_IDS，两处划分必须同步演进。
export const ADVANCED_TAB_IDS = ['prompt', 'worldinfo', 'filter', 'debug'] as const satisfies readonly TabId[];

/** 简化模式下过滤掉高级 tab；只过滤不排序，展示顺序始终跟随传入数组本身 */
export function visibleTabs(all: TabDefinition[], advanced: boolean): TabDefinition[] {
  if (advanced) return all;
  const advancedIds = new Set<string>(ADVANCED_TAB_IDS);
  return all.filter(t => !advancedIds.has(t.id));
}
