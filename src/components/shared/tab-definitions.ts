export type TabId = 'pool' | 'generation' | 'prompt' | 'api' | 'worldinfo' | 'filter' | 'appearance' | 'debug';

export type StatusTabId = 'status_settings' | 'status_prompt';

export interface TabDefinition {
  id: string;
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

// 被动状态大页的子 tab：仅状态专属两页。API/世界书/过滤统一在行动选项大页配置（数据同源，两链路共用）
export const STATUS_TABS: TabDefinition[] = [
  { id: 'status_settings', label: '状态设置', icon: 'fa-solid fa-sliders' },
  { id: 'status_prompt', label: '状态提示词', icon: 'fa-solid fa-align-left' },
];
