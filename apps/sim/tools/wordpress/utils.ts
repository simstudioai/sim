/**
 * Splits a list of WordPress term IDs into trimmed, non-empty entries. Accepts the block's
 * comma-separated string as well as the number or array a model may send on a tool call.
 */
export function splitIdList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value).split(',')
  return entries.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
}

/** {@link splitIdList}, parsed to integers with unparseable entries dropped. */
export function parseIdList(value: unknown): number[] {
  return splitIdList(value)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((id) => !Number.isNaN(id))
}
