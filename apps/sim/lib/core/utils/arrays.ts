/**
 * Normalizes optional string-list values loaded from untyped persisted state.
 */
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}
