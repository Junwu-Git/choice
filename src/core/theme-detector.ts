/**
 * ST 主题自动检测模块
 * 通过读取 ST 的 --SmartThemeBlurTintColor CSS 变量判断当前亮/暗主题，
 * 并用 MutationObserver 监听变化，驱动扩展的 data-choice-theme 自动切换。
 */

/** 感知亮度阈值：高于此值判定为亮色主题 */
const LUMINANCE_THRESHOLD = 128;

/** 解析 CSS 颜色字符串中的 RGB 分量 */
function parseRGB(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/** 计算感知亮度（ITU-R BT.601 加权） */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 检测 ST 当前主题是亮色还是暗色 */
export function detectSTTheme(): 'dark' | 'light' {
  const bgColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--SmartThemeBlurTintColor')
    .trim();

  if (!bgColor) {
    // ST 变量不存在时回退到系统偏好
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  const rgb = parseRGB(bgColor);
  if (!rgb) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return luminance(rgb[0], rgb[1], rgb[2]) > LUMINANCE_THRESHOLD ? 'light' : 'dark';
}

/**
 * 监听 ST 主题变化。
 * 返回取消监听的函数，调用方应在组件卸载时调用。
 */
export function watchSTTheme(callback: (theme: 'dark' | 'light') => void): () => void {
  let lastTheme = detectSTTheme();

  const observer = new MutationObserver(() => {
    const current = detectSTTheme();
    if (current !== lastTheme) {
      lastTheme = current;
      callback(current);
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

  return () => observer.disconnect();
}

/** WCAG 相对亮度（与上面的感知亮度不同：守卫必须用 WCAG 公式，否则对比度结论不可靠） */
function wcagLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = wcagLuminance(a);
  const lb = wcagLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface STInkFallback {
  text: string;
  secondary: string;
  muted: string;
}

/**
 * st 跟随模式的对比度守卫：
 * ST 用户可能配出"文字色 ≈ 背景色"的极端主题，直接派生会导致全界面看不清。
 * 当 BodyColor 与 BlurTint 对比不足 4.5:1 时，忽略 ST 的 BodyColor，
 * 按检测极性返回一整套兜底墨色；对比足够时返回 null（表示沿用 CSS 派生值）。
 */
export function getSTInkFallback(): STInkFallback | null {
  const style = getComputedStyle(document.documentElement);
  const bodyRaw = style.getPropertyValue('--SmartThemeBodyColor').trim();
  const bgRaw = style.getPropertyValue('--SmartThemeBlurTintColor').trim();
  if (!bodyRaw || !bgRaw) return null;

  const body = parseRGB(bodyRaw);
  const bg = parseRGB(bgRaw);
  if (!body || !bg) return null;

  if (contrastRatio(body, bg) >= 4.5) return null;

  // 兜底墨色按底色极性选定，保证最基础的正文可读性
  if (luminance(bg[0], bg[1], bg[2]) > LUMINANCE_THRESHOLD) {
    return { text: '#292621', secondary: '#55514a', muted: '#757066' };
  }
  return { text: '#e8eaee', secondary: '#b4b8c0', muted: '#8a8f98' };
}