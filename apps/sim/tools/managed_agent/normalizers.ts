/**
 * Pure normalization helpers that shape the Managed Agent block's subblock
 * values (which arrive in several runtime shapes — table rows, JSON strings,
 * flat objects, comma-lists) into the tidy typed values the session runner
 * expects. No server deps so each helper is directly unit-testable.
 */

export function normalizeMemoryAccess(value: unknown): 'read_write' | 'read_only' | undefined {
  if (value === 'read_write' || value === 'read_only') return value
  return undefined
}

/**
 * A `switch` value may arrive as a real boolean or as a string (`"true"`,
 * `"1"`, `"yes"`) depending on serialization. Treat every reasonable
 * "checked" form as truthy; anything else as not-checked.
 */
export function isTruthyAck(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

/**
 * Coerces the block's file table into `{ fileId, mountPath? }[]` for the
 * session `resources` array (`{ type: 'file', file_id, mount_path? }`). Reads
 * the `File ID` / `Mount path` column shape, the flat `{ fileId, mountPath }`
 * shape, and plain string / comma / json id lists. Drops blank ids.
 */
export function normalizeFiles(value: unknown): Array<{ fileId: string; mountPath?: string }> {
  // A table subblock can arrive JSON-stringified. Parse a leading-'[' string
  // into its array form first, so rows of objects aren't mistaken for a plain
  // string list (which would silently drop every file attachment).
  let normalized: unknown = value
  if (typeof normalized === 'string' && normalized.trim().startsWith('[')) {
    try {
      normalized = JSON.parse(normalized.trim())
    } catch {
      // Not valid JSON — leave as a string; handled as a comma/single id below.
    }
  }
  if (
    typeof normalized === 'string' ||
    (Array.isArray(normalized) && normalized.every((v) => typeof v === 'string'))
  ) {
    return normalizeStringList(normalized).map((fileId) => ({ fileId }))
  }
  if (!Array.isArray(normalized)) return []
  const out: Array<{ fileId: string; mountPath?: string }> = []
  for (const raw of normalized) {
    if (typeof raw === 'string') {
      if (raw.trim()) out.push({ fileId: raw.trim() })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const cells =
      record.cells && typeof record.cells === 'object'
        ? (record.cells as Record<string, unknown>)
        : record
    const readString = (key: string): string | undefined =>
      typeof cells[key] === 'string' ? (cells[key] as string) : undefined
    const fileId = readString('fileId') ?? readString('File ID') ?? readString('file_id') ?? ''
    if (!fileId.trim()) continue
    const mountPath =
      readString('mountPath') ?? readString('Mount path') ?? readString('mount_path')
    out.push({
      fileId: fileId.trim(),
      ...(mountPath?.trim() ? { mountPath: mountPath.trim() } : {}),
    })
  }
  return out
}

/**
 * Coerce a multi-select combobox / json input — array, JSON-encoded array
 * string, comma-separated string, or single string — into a trimmed
 * `string[]`.
 */
export function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim())
  }
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    // Meant to be a JSON array — parse it, but do NOT comma-split the raw JSON
    // text on failure (that yields garbage tokens like `["x"`). An empty result
    // is the honest outcome for a malformed/non-array JSON string.
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      }
    } catch {
      // fall through to []
    }
    return []
  }
  return trimmed
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/**
 * Coerce the block's metadata table into `Record<string,string>` for the
 * session `metadata` field. Accepts `WorkflowTableRow[]`, a JSON-encoded
 * array string, or a flat object. Drops rows with a blank key.
 */
export function normalizeSessionParameters(value: unknown): Record<string, string> | undefined {
  const rows = coerceToRows(value)
  if (rows === undefined) return undefined
  const out: Record<string, string> = {}
  for (const row of rows) {
    const key = typeof row.key === 'string' ? row.key.trim() : ''
    if (!key) continue
    // Metadata is a string map. Preserve scalar values (a flat object can carry
    // numbers/booleans) by stringifying them; drop non-scalars to empty.
    const raw = row.value
    out[key] =
      typeof raw === 'string'
        ? raw
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : ''
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function coerceToRows(value: unknown): Array<{ key: unknown; value: unknown }> | undefined {
  if (Array.isArray(value)) return value.map((row) => tableRowToPair(row))
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || !trimmed.startsWith('[')) return undefined
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map((row) => tableRowToPair(row))
    } catch {
      return undefined
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
      key,
      value: val,
    }))
  }
  return undefined
}

function tableRowToPair(row: unknown): { key: unknown; value: unknown } {
  if (!row || typeof row !== 'object') return { key: undefined, value: undefined }
  const record = row as Record<string, unknown>
  const cells =
    record.cells && typeof record.cells === 'object'
      ? (record.cells as Record<string, unknown>)
      : record
  return { key: cells.Key ?? cells.key, value: cells.Value ?? cells.value }
}
