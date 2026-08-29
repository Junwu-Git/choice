import { characters } from '@sillytavern/script';

/**
 * 按角色 id 取角色卡对象；取不到返回 undefined。
 *
 * this_chid 的酒馆官方类型是 string|undefined（"Stringified index"，见 public/script.js
 * 声明注释），字符串下标访问 characters 数组在 TS 层报 TS7015；运行时 JS 数组接受
 * 数字字符串下标，故统一经 Number() 归一化。必须排除空串：Number('') === 0 会误取
 * 0 号位角色；非数字 id（理论不出现）安全降级为 undefined。
 *
 * generator.ts 与 global-settings.ts 都要用它：helper 不能放在 generator 里
 * （generator 依赖 global-settings store，反向导入会成环），故独立成文件。
 */
export function getStCharacter(id: string | number | null | undefined): StCharacter | undefined {
  if (id == null || id === '') return undefined;
  const idx = Number(id);
  if (Number.isNaN(idx)) return undefined;
  return characters[idx] as StCharacter | undefined;
}
