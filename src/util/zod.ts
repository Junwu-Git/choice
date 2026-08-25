export function validateInplace<T>(schema: z.ZodType<T>, data: unknown): T {
<<<<<<< HEAD
  if (data === undefined || data === null) {
    return parsePrettified(schema, data);
  }
=======
>>>>>>> a5b9d5fa09489da971f8abba1664ce02a1e4eabb
  const result = parsePrettified(schema, data);
  return _.assign(data, result) as T;
}

export function parsePrettified<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Error(z.prettifyError(result.error));
  }
  return result.data;
}
