/**
 * Pure normalization helpers used by the Managed Agent workflow-block tool
 * to shape user input from Sim's block subblocks (which store their values
 * in several different runtime shapes) into the tidy typed values the
 * Anthropic session-client expects.
 *
 * Kept in a client-safe module (no `import 'server-only'`, no DB, no `env`)
 * so the tests can import each helper directly without loading the whole
 * session runtime and its side-effect registration.
 */

import type { ManagedAgentEnvType } from '@/lib/managed-agents/session-client'

export function normalizeEnvType(
  value: string | undefined
): ManagedAgentEnvType | undefined {
  if (value === 'cloud' || value === 'self_hosted') return value
  return undefined
}

export function normalizeMemoryAccess(
  value: string | undefined
): 'read_write' | 'read_only' | undefined {
  if (value === 'read_write' || value === 'read_only') return value
  return undefined
}

/**
 * A subblock's `switch` value may arrive as a real boolean or as a
 * string (`"true"`, `"1"`, `"yes"`) depending on how the workflow was
 * serialized. Treat every reasonable "checked" form as truthy; anything
 * else — including `false`, empty string, `undefined`, non-string
 * non-boolean values — as not-checked.
 */
export function isTruthyAck(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

/**
 * Coerces the block's file table (a JSON array of `{fileId, mountPath?}`
 * or the raw table-subblock shape `Array<{Key: string, Value: string}>`)
 * into the tidy shape the session-client expects. Silently drops rows
 * missing a file id.
 */
export function normalizeFiles(
  value: unknown
): Array<{ fileId: string; mountPath?: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ fileId: string; mountPath?: string }> = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const cells =
      record.cells && typeof record.cells === 'object'
        ? (record.cells as Record<string, unknown>)
        : record
    const fileId =
      typeof cells.fileId === 'string'
        ? cells.fileId
        : typeof cells.Key === 'string'
          ? cells.Key
          : ''
    if (!fileId.trim()) continue
    const mountPath =
      typeof cells.mountPath === 'string'
        ? cells.mountPath
        : typeof cells.Value === 'string'
          ? cells.Value
          : undefined
    out.push({
      fileId: fileId.trim(),
      ...(mountPath && mountPath.trim() ? { mountPath: mountPath.trim() } : {}),
    })
  }
  return out
}

/**
 * Coerce whatever shape the multi-select combobox / json input ends up
 * with — an array, a JSON-encoded array string, a comma-separated string,
 * or a single string — into a trimmed `string[]`. Handles the case where
 * a `type: 'json'` input isn't parsed for us (fresh workflows, stale
 * serialization, block hydration).
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
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      }
    } catch {
      // fall through to comma-split
    }
  }
  return trimmed
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/**
 * Coerce the block's session-parameters value into a `Record<string,string>`
 * ready for the Anthropic session-create `metadata` field.
 *
 * The `table` subblock stores rows as `WorkflowTableRow[]` — an array of
 * `{ id, cells: { Key: string, Value: string } }` — not a flat object. It
 * may also arrive as a JSON-encoded array string (fresh workflows, some
 * hydration paths) or the flat `Record<string,string>` shape (older
 * serializations). Handle all three; drop rows/pairs with a blank key.
 */
export function normalizeSessionParameters(
  value: unknown
): Record<string, string> | undefined {
  const rows = coerceToRows(value)
  if (rows === undefined) return undefined
  const out: Record<string, string> = {}
  for (const row of rows) {
    const key = typeof row.key === 'string' ? row.key.trim() : ''
    if (!key) continue
    const val = typeof row.value === 'string' ? row.value : ''
    out[key] = val
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function coerceToRows(
  value: unknown
): Array<{ key: unknown; value: unknown }> | undefined {
  if (Array.isArray(value)) {
    return value.map((row) => tableRowToPair(row))
  }
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
