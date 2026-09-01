/**
 * 主题注册表：面板循环切换按钮与 AppearanceSettings 共用的唯一来源。
 * 循环顺序即数组顺序（面板按钮按序循环回绕）；label 是 UI 展示名。
 * 增删主题时三处必须同步改：本数组、settings.ts 的 theme_mode 枚举、theme.css 的
 * data-choice-theme token 块——漏 CSS 块会静默回落暗色默认 token，构建不报错。
 * auto/st/dark/light 是功能档（检测/跟随/覆盖），其余为独立预设主题。
 */
export interface ThemeOption {
  id: 'auto' | 'st' | 'dark' | 'light' | 'dusk' | 'sakura' | 'celadon' | 'honey';
  label: string;
  /** mode = 功能档（检测/跟随/亮暗覆盖），preset = 独立预设主题（theme.css 完整 token 块） */
  kind: 'mode' | 'preset';
  /** AppearanceSettings 预设按钮上的色点颜色（与 theme.css 主色保持一致，手工同步） */
  swatch: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: 'auto', label: '自动', kind: 'mode', swatch: '' },
  { id: 'st', label: '跟随', kind: 'mode', swatch: '' },
  { id: 'dark', label: '暗色', kind: 'mode', swatch: '' },
  { id: 'light', label: '亮色', kind: 'mode', swatch: '' },
  { id: 'dusk', label: '暮紫', kind: 'preset', swatch: '#9d7ce8' },
  { id: 'sakura', label: '樱粉', kind: 'preset', swatch: '#b84f77' },
  { id: 'celadon', label: '青瓷', kind: 'preset', swatch: '#4aa8a0' },
  { id: 'honey', label: '蜜杏', kind: 'preset', swatch: '#96600f' },
] as const;

/** 循环切换：返回 mode 在 THEME_OPTIONS 中的下一个值（末尾回绕到首个） */
export function nextThemeMode(mode: ThemeOption['id']): ThemeOption['id'] {
  const idx = THEME_OPTIONS.findIndex(t => t.id === mode);
  // findIndex 失配（-1，理论不可达：枚举与注册表同源）时兜底回 auto
  return THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length]?.id ?? 'auto';
}

export function themeLabel(mode: ThemeOption['id']): string {
  return THEME_OPTIONS.find(t => t.id === mode)?.label ?? mode;
}
