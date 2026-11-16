import { isRecordLike } from '@sim/utils/object'
import type { BlockKey, BranchKey, CanonicalBranches, CanonicalBranchRow, Json } from '../model'
import { setOwn } from '../records'
import { type CanonContext, report } from './context'
import { toJson, toValue } from './values'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Editor state the condition/router input writes into each row (condition-input.tsx:292-300). */
const UI_ROW_KEYS = new Set([
  'showTags',
  'showEnvVars',
  'searchTerm',
  'cursorPosition',
  'activeSourceBlockId',
])
const MODELED_ROW_KEYS = new Set(['id', 'title', 'value', 'key'])

export interface LiftedBranches {
  branches: CanonicalBranches
  /** Branch key → stored row id (or the implicit id a never-persisted row answers to). */
  ids: Record<BranchKey, string>
  /** Row id → branch key, for edge handles. */
  keyByRowId: Map<string, BranchKey>
  /** Set when the stored value could not be lifted; the caller keeps it as a plain param. */
  unliftedValue?: unknown
}

type StoredRow = Record<string, unknown> & { value: string; id?: string; title?: string }

function isStoredRow(item: unknown): item is StoredRow {
  return (
    isRecordLike(item) &&
    typeof item.value === 'string' &&
    (item.id === undefined || typeof item.id === 'string') &&
    (item.title === undefined || typeof item.title === 'string')
  )
}

function parseRows(value: unknown): { rows: unknown[] | null; parsed: boolean } {
  if (Array.isArray(value)) return { rows: value, parsed: true }
  if (typeof value !== 'string' || value.trim() === '') return { rows: null, parsed: false }
  try {
    const decoded: unknown = JSON.parse(value)
    return Array.isArray(decoded) ? { rows: decoded, parsed: true } : { rows: null, parsed: false }
  } catch {
    return { rows: null, parsed: false }
  }
}

/** Positional default keys mirror the copilot handles (validation.ts:1091-1130), quirk 8. */
export function positionalKeys(kind: CanonicalBranches['kind'], count: number): BranchKey[] {
  if (kind === 'router') return Array.from({ length: count }, (_, index) => `route${index}`)
  let elseIf = 0
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 'if'
    if (index === count - 1) return 'else'
    return `elseIf${elseIf++}`
  })
}

/** The title the canvas shows (condition-input.tsx:395-401, 686-693; router line 921). */
export function positionalTitle(
  kind: CanonicalBranches['kind'],
  index: number,
  count: number
): string {
  if (kind === 'router') return `Route ${index + 1}`
  if (index === 0) return 'if'
  if (index === count - 1) return 'else'
  return 'else if'
}

/**
 * Ids a never-persisted (or unparseable, or empty) branch list answers to, keyed by default key:
 * `getConditionRows` / `getRouterRows` fallbacks (dynamic-handle-topology.ts:57-100), quirk 7.
 */
export function implicitIds(
  kind: CanonicalBranches['kind'],
  blockId: string
): Record<BranchKey, string> {
  return kind === 'router'
    ? { route0: `${blockId}-route1` }
    : { if: `${blockId}-if`, else: `${blockId}-else` }
}

/** The id `getConditionRows` / `getRouterRows` give a stored row that has none. */
function derivedRowId(kind: CanonicalBranches['kind'], blockId: string, index: number): string {
  return kind === 'router' ? `${blockId}-route${index + 1}` : `${blockId}-cond-${index}`
}

function uniqueKey(base: BranchKey, taken: ReadonlySet<BranchKey>): BranchKey {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

function withImplicit(
  kind: CanonicalBranches['kind'],
  blockId: string,
  rows: CanonicalBranchRow[] | null,
  unliftedValue?: unknown
): LiftedBranches {
  const ids = implicitIds(kind, blockId)
  const keyByRowId = new Map(Object.entries(ids).map(([key, id]) => [id, key]))
  return {
    branches: { kind, rows },
    ids,
    keyByRowId,
    ...(unliftedValue !== undefined ? { unliftedValue } : {}),
  }
}

/**
 * Lifts the `conditions` / `routes` subBlock into named branches (s1 canonicalize step 6,
 * quirks 4–8). Keys resolve lock (by row id) → persisted row `key` → positional default; a key
 * already taken gets a `_n` suffix. UI state is stripped, a stored title that differs from the
 * positional one becomes `titleOverride` (condition titles are semantic: the executor finds
 * `else` by title, condition/handler.ts:474). A never-persisted value is `rows: null` and answers
 * to the implicit ids. A value that is not a list of `{ id?, title?, value }` rows is returned
 * as `unliftedValue` for the caller to keep verbatim.
 */
export function liftBranches(
  kind: CanonicalBranches['kind'],
  blockId: string,
  blockKey: BlockKey,
  param: string,
  stored: unknown,
  lockKeyByRowId: ReadonlyMap<string, BranchKey>,
  context: CanonContext
): LiftedBranches {
  if (stored === null || stored === undefined) return withImplicit(kind, blockId, null)

  const { rows: storedRows, parsed } = parseRows(stored)
  if (!parsed) {
    if (typeof stored !== 'string' || stored.trim() !== '') {
      report(context, {
        code: 'W_CANON_UNDECODABLE_JSON',
        severity: 'warning',
        message: `Stored ${kind} branches are not a JSON list; kept verbatim`,
        blockKey,
        param,
      })
    }
    return withImplicit(kind, blockId, null, stored)
  }
  if (!storedRows || !storedRows.every(isStoredRow)) {
    report(context, {
      code: 'W_CANON_UNDECODABLE_JSON',
      severity: 'warning',
      message: `Stored ${kind} branches are not a list of { id, title, value } rows; kept verbatim`,
      blockKey,
      param,
    })
    return {
      branches: { kind, rows: null },
      ids: {},
      keyByRowId: new Map(),
      unliftedValue: stored,
    }
  }
  if (storedRows.length === 0) return withImplicit(kind, blockId, [])

  const count = storedRows.length
  const rowIds = storedRows.map((row, index) => row.id ?? derivedRowId(kind, blockId, index))
  const keys: Array<BranchKey | undefined> = new Array(count)
  const taken = new Set<BranchKey>()

  rowIds.forEach((rowId, index) => {
    const key = lockKeyByRowId.get(rowId)
    if (key !== undefined && IDENTIFIER.test(key) && !taken.has(key)) {
      keys[index] = key
      taken.add(key)
    }
  })
  storedRows.forEach((row, index) => {
    if (keys[index] !== undefined) return
    const key = row.key
    if (typeof key === 'string' && IDENTIFIER.test(key) && !taken.has(key)) {
      keys[index] = key
      taken.add(key)
    }
  })
  const defaults = positionalKeys(kind, count)
  for (let index = 0; index < count; index++) {
    if (keys[index] !== undefined) continue
    const key = uniqueKey(defaults[index], taken)
    keys[index] = key
    taken.add(key)
  }

  const rows: CanonicalBranchRow[] = []
  const ids: Record<BranchKey, string> = {}
  const keyByRowId = new Map<string, BranchKey>()
  storedRows.forEach((stored, index) => {
    const key = keys[index] ?? defaults[index]
    const row: CanonicalBranchRow = { key, value: toValue(stored.value, context) as string }
    const positional = positionalTitle(kind, index, count)
    if (stored.title === undefined) {
      row.titleMissing = true
    } else if (stored.title !== positional) {
      row.titleOverride = stored.title
      if (kind === 'condition') {
        report(context, {
          code: 'W_CANON_TITLE_OVERRIDE',
          severity: 'warning',
          message: `Branch ${index + 1} is titled "${stored.title}" but shows as "${positional}"; the executor matches else by stored title`,
          blockKey,
          param,
        })
      }
    }
    const extra: Record<string, Json> = {}
    for (const [field, value] of Object.entries(stored)) {
      if (MODELED_ROW_KEYS.has(field) || UI_ROW_KEYS.has(field) || value === undefined) continue
      setOwn(extra, field, toJson(value))
    }
    if (Object.keys(extra).length > 0) row.extra = extra
    rows.push(row)
    setOwn(ids, key, rowIds[index])
    if (!keyByRowId.has(rowIds[index])) keyByRowId.set(rowIds[index], key)
  })
  return { branches: { kind, rows }, ids, keyByRowId }
}
