/** Table output schemas expose operation status to downstream workflow references. */
export function tableSuccess<T extends Record<string, unknown>>(
  output: T
): { success: true; output: T & { success: true } } {
  return { success: true, output: { ...output, success: true } }
}
