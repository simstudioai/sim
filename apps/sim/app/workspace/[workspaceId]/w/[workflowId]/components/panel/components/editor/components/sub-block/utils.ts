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

/**
 * Parses a sub-block value that may be stored as a JSON string or as an already-parsed array.
 *
 * @remarks
 * These sub-blocks contract on a JSON string, which is what their components write. Copilot's
 * `edit_workflow` persisted them as raw arrays until it was fixed to re-serialize, so rows
 * written by older builds still hold an array. Both shapes are accepted on read.
 *
 * @param value - The stored sub-block value, of unknown shape
 * @returns The parsed array, or `[]` when the value is absent, unparseable, or not an array
 */
export function parseJsonArrayValue(value: unknown): unknown[] {
  if (!value) return []
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(parsed) ? parsed : []
}
