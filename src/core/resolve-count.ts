import { GenerationSettings } from '@/type/settings';

const RESOLVE_COUNT_DEFAULT = parseInt(GenerationSettings.parse({}).count_mode, 10) || 4;

/** 解析 global_count_mode（自由文本「4」或「3-6」）：非法输入（非数字/0）此前产出 count=0
 *  → 池抽取为空、整趟请求照发后才报「未能解析出任何选项」，把配置问题误导成模型问题；
 *  区间 min>max（如 8-3）则乘负数得反直觉均匀分布。收敛在此规整：换序、非法/非正值
 *  回退 schema 默认、下限 1——调用方拿到的恒为 ≥1 的可用值。
 *  勿加数量上限：条目池可上百，大池一次要 50+ 选项是合法用法（曾有 20 的硬钳制把
 *  50-70 配置静默压扁，已回退）；超大值白耗 token 属用户显式意愿，不由扩展裁决。 */
export const resolveCount = (cm: string): number => {
  const s = cm.trim();
  const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    let min = parseInt(rangeMatch[1], 10);
    let max = parseInt(rangeMatch[2], 10);
    if (min > max) [min, max] = [max, min];
    return Math.max(1, min + Math.floor(Math.random() * (max - min + 1)));
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : RESOLVE_COUNT_DEFAULT;
};
