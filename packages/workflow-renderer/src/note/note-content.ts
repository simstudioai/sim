/**
 * Resolves a string stored directly or inside a serialized subblock value.
 *
 * Note subblocks reach readers in two shapes — a raw string from the canvas
 * store, and a `{ value }` wrapper from a serialized/preview workflow. Reading
 * only one of them sizes a filled note as empty, so every consumer resolves
 * through here rather than re-deriving the check.
 */
export function getNoteStringValue(rawValue: unknown): string | undefined {
  if (typeof rawValue === 'string') return rawValue
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    const candidate = (rawValue as { value?: unknown }).value
    return typeof candidate === 'string' ? candidate : undefined
  }
  return undefined
}

/** Whether a note's stored content paints as the empty placeholder. */
export function isNoteContentEmpty(rawValue: unknown): boolean {
  return (getNoteStringValue(rawValue) ?? '').trim().length === 0
}
