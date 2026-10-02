/**
 * Reads a switch that may arrive as a boolean or, from block inputs and
 * workflow variables, as the string `'true'`/`'false'`.
 */
export function isEnabled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return value === true
}
