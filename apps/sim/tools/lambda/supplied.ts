/**
 * True when an optional tool param carries a real value. A direct LLM tool call can pass
 * `null` or an empty string for a param the caller means to omit; forwarding either turns
 * into a contract rejection, or an empty `Qualifier` that AWS refuses.
 */
export function isSupplied(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}
