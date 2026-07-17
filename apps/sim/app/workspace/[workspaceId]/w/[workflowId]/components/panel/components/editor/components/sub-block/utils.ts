/**
 * Extracts the raw value from a preview context entry.
 *
 * @remarks
 * In the sub-block preview context, values are wrapped as `{ value: T }` objects
 * (the full sub-block state). In the tool-input preview context, values are already
 * raw. This function normalizes both cases to return the underlying value.
 *
 * @param raw - The preview context entry, which may be a raw value or a `{ value: T }` wrapper
 * @returns The unwrapped value, or `null` if the input is nullish
 */
export function resolvePreviewContextValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return (raw as Record<string, unknown>).value ?? null
  }
  return raw
}
