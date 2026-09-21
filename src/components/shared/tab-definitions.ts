// 导航两级结构：一级页（导航栏 4 个胶囊）× 子区（页内分段控件）。
// 子区 id 沿用旧 TabId 语义——引导 PAGE_HINTS、信号 requestedTab /
// onboardingPendingTab、OnboardingStep.tab 全部以子区 id 为键，故保留该类型名，
// 仅把「扁平 9 tab」重组为「4 页 × 子区」。

/** 一级页 id（导航栏胶囊） */
export type PageId = 'content' | 'generation' | 'stats' | 'system';

/** 子区 id（= 旧 TabId；引导与信号键不变） */
export type TabId =
  'pool' | 'generation' | 'prompt' | 'api' | 'worldinfo' | 'filter' | 'stats' | 'appearance' | 'debug';

interface SubAreaDefinition {
  id: TabId;
  label: string;
  icon: string;
}

interface PageDefinition {
  id: PageId;
  label: string;
  icon: string;
  subAreas: SubAreaDefinition[];
}

/** 一级页与其子区。顺序即展示顺序 */
export const PAGES: PageDefinition[] = [
  {
    id: 'content',
    label: '内容',
    icon: 'fa-solid fa-layer-group',
    subAreas: [
      { id: 'pool', label: '条目池', icon: 'fa-solid fa-layer-group' },
      { id: 'prompt', label: '提示词', icon: 'fa-solid fa-align-left' },
      { id: 'worldinfo', label: '世界书', icon: 'fa-solid fa-book' },
      { id: 'filter', label: '过滤', icon: 'fa-solid fa-filter' },
    ],
  },
  {
    id: 'generation',
    label: '生成',
    icon: 'fa-solid fa-bolt',
    subAreas: [
      { id: 'generation', label: '生成', icon: 'fa-solid fa-bolt' },
      { id: 'api', label: 'API', icon: 'fa-solid fa-plug' },
    ],
  },
  {
    id: 'stats',
    label: '统计',
    icon: 'fa-solid fa-ranking-star',
    subAreas: [{ id: 'stats', label: '统计', icon: 'fa-solid fa-ranking-star' }],
  },
  {
    id: 'system',
    label: '系统',
    icon: 'fa-solid fa-gear',
    subAreas: [
      { id: 'appearance', label: '外观', icon: 'fa-solid fa-palette' },
      { id: 'debug', label: '调试', icon: 'fa-solid fa-bug' },
    ],
  },
];

// 高级子区（advanced_features_enabled=false 时隐藏）。语义从「隐藏整 tab」改为
// 「隐藏高级子区」：content 页隐藏 prompt/worldinfo/filter、system 页隐藏 debug。
// api 属首配必经路径留在基础层；stats 是用户常看的用量页，也留在基础层。
// guide-content 的 isAdvancedChapter 复用本集合，两处划分必须同步演进。
export const ADVANCED_TAB_IDS = ['prompt', 'worldinfo', 'filter', 'debug'] as const satisfies readonly TabId[];

/** 某一级页在当前简化模式下可见的子区；仅过滤不排序，展示顺序跟随 page.subAreas */
export function visibleSubAreas(page: PageDefinition, advanced: boolean): SubAreaDefinition[] {
  if (advanced) return page.subAreas;
  const advancedIds = new Set<string>(ADVANCED_TAB_IDS);
  return page.subAreas.filter(s => !advancedIds.has(s.id));
}

/** 子区 id → 所属一级页（信号 requestedTab / onboardingPendingTab 是子区 id，
 *  消费时需映射到 page 才能同步两级状态；找不到回退首页 content） */
export function pageOfSubArea(subAreaId: TabId): PageDefinition {
  return PAGES.find(p => p.subAreas.some(s => s.id === subAreaId)) ?? PAGES[0];
}

/** 某一级页首个可见子区（切页 / 简化守卫弹回时用） */
export function firstVisibleSubArea(page: PageDefinition, advanced: boolean): SubAreaDefinition {
  return visibleSubAreas(page, advanced)[0];
}
