// 显式导入 z：auto-imports.d.ts 生成的全局 const z（typeof import('zod').z）在类型位置
// 无法当命名空间用（z.ZodType/z.output 报 TS2503，且该文件被 gitignore 随时重生成），不能用
import { z } from 'zod';

// 用 <S extends z.ZodType> + z.output<S> 而非 <T>(schema: z.ZodType<T>)：
// zod4 的 schema 类型与 ZodType<T> 的协变推断在复杂 object 上会推不出 T（fallback 成
// unknown/any），导致调用方拿到 any 并把隐式 any 扩散到整个 store；z.output<S> 从
// schema 类型直接取输出，推断稳定。
export function validateInplace<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  if (data === undefined || data === null) {
    return parsePrettified(schema, data);
  }
  const result = parsePrettified(schema, data);
  // validateInplace 语义：把解析结果就地合并回原对象（保留原引用的响应式/挂载关系）
  return _.assign(data, result) as z.output<S>;
}

export function parsePrettified<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Error(z.prettifyError(result.error));
  }
  return result.data;
}
