/**
 * `file-upload` subblock remapping for fork/promote.
 *
 * A `file-upload` value is a workspace-file reference (or array of them) stored as
 * objects `{ key, name, ... }` where `key` is the object-storage key (NOT the
 * `workspace_files.id`). Forking copies the blob to a new key; this rewrites each
 * reference's key to the copied key, preserving the rest of the object. References
 * whose file was not copied are dropped (the field is emptied) rather than left
 * pointing at another workspace's blob. External `file-selector` references
 * (provider file ids, credential-scoped) are NOT handled here - they carry over
 * unchanged.
 */

function parseMaybeJson(value: unknown): { value: unknown; serialized: boolean } {
  if (typeof value !== 'string') return { value, serialized: false }
  const trimmed = value.trim()
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (!looksJson) return { value, serialized: false }
  try {
    return { value: JSON.parse(trimmed), serialized: true }
  } catch {
    return { value, serialized: false }
  }
}

/** The field a file-upload item uses as its storage key, and that key's value. */
function fileItemKeyField(item: unknown): { field: 'key' | 'path' | 'name'; key: string } | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const record = item as Record<string, unknown>
  for (const field of ['key', 'path', 'name'] as const) {
    const value = record[field]
    if (typeof value === 'string' && value.trim().length > 0) return { field, key: value }
  }
  return null
}

/**
 * Enumerate the workspace-file storage keys referenced by a `file-upload` subblock
 * value (single object, array, or JSON-string form). Used at promote time to emit each
 * workspace file as a `file` reference (keyed by storage key) so it surfaces in the
 * scan / unmapped set and can be copied into the target. Deduplicated, order-preserving.
 */
export function collectForkFileUploadKeys(value: unknown): string[] {
  const parsed = parseMaybeJson(value)
  const items = Array.isArray(parsed.value)
    ? (parsed.value as unknown[])
    : parsed.value
      ? [parsed.value]
      : []
  const keys: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const keyInfo = fileItemKeyField(item)
    if (!keyInfo || seen.has(keyInfo.key)) continue
    seen.add(keyInfo.key)
    keys.push(keyInfo.key)
  }
  return keys
}

/**
 * Remap a `file-upload` subblock value. `resolveFileKey(sourceKey)` returns the
 * copied target storage key, or null when the file was not copied (drop the ref).
 */
export function remapForkFileUploadValue(
  value: unknown,
  resolveFileKey: (sourceKey: string) => string | null
): unknown {
  const parsed = parseMaybeJson(value)
  const isArray = Array.isArray(parsed.value)
  const items = isArray ? (parsed.value as unknown[]) : parsed.value ? [parsed.value] : []
  if (items.length === 0) return value

  const next: unknown[] = []
  let changed = false
  for (const item of items) {
    const keyInfo = fileItemKeyField(item)
    if (!keyInfo) {
      next.push(item)
      continue
    }
    const targetKey = resolveFileKey(keyInfo.key)
    if (targetKey == null) {
      changed = true
      continue
    }
    if (targetKey === keyInfo.key) {
      next.push(item)
      continue
    }
    changed = true
    next.push({ ...(item as Record<string, unknown>), [keyInfo.field]: targetKey })
  }

  if (!changed) return value
  if (next.length === 0) return ''
  if (isArray) return parsed.serialized ? JSON.stringify(next) : next
  return parsed.serialized ? JSON.stringify(next[0]) : next[0]
}
