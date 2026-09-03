export type TabId = 'pool' | 'generation' | 'prompt' | 'api' | 'worldinfo' | 'filter' | 'appearance' | 'debug';

export interface TabDefinition {
  id: TabId;
  label: string;
  icon: string;
}

export const INLINE_TABS: TabDefinition[] = [
  { id: 'pool', label: '条目池', icon: 'fa-solid fa-layer-group' },
  { id: 'generation', label: '生成', icon: 'fa-solid fa-bolt' },
  { id: 'prompt', label: '提示词', icon: 'fa-solid fa-align-left' },
  { id: 'api', label: 'API', icon: 'fa-solid fa-plug' },
  { id: 'worldinfo', label: '世界书', icon: 'fa-solid fa-book' },
  { id: 'filter', label: '过滤', icon: 'fa-solid fa-filter' },
  { id: 'appearance', label: '外观', icon: 'fa-solid fa-palette' },
  { id: 'debug', label: '调试', icon: 'fa-solid fa-gear' },
];

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
