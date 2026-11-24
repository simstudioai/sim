import { isRecordLike } from '@sim/utils/object'
import { isIdentifierName } from '../code-files/ref-path'
import { diagnostic } from '../diagnostics/factory'
import type { BlockKey, BranchKey, CanonicalBranches, CanonicalBranchRow, Json } from '../model'
import { parseStoredList, setOwn } from '../records'
import type { CanonContext } from './context'
import { toJson, toValue } from './values'

/** Editor state the condition/router input writes into each row (condition-input.tsx). */
const UI_ROW_KEYS = new Set([
  'showTags',
  'showEnvVars',
  'searchTerm',
  'cursorPosition',
  'activeSourceBlockId',
])
const MODELED_ROW_KEYS = new Set(['id', 'title', 'value', 'key'])

/**
 * Whether a stored row field round-trips through a row's `extra`: not a field the row models
 * (`id`, `title`, `value`, `key`) and not editor state, which canonicalize drops.
 */
export function isBranchExtraField(field: string): boolean {
  return !MODELED_ROW_KEYS.has(field) && !UI_ROW_KEYS.has(field)
}

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

/** Positional default keys mirror the copilot handles (`validateConditionHandle`). */
export function positionalKeys(kind: CanonicalBranches['kind'], count: number): BranchKey[] {
  if (kind === 'router') return Array.from({ length: count }, (_, index) => `route${index}`)
  let elseIf = 0
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 'if'
    if (index === count - 1) return 'else'
    return `elseIf${elseIf++}`
  })
}

/**
 * The title a branch row is stored with: its override, else the positional one, or none for a row
 * stored without a title.
 */
export function storedTitle(
  kind: CanonicalBranches['kind'],
  row: CanonicalBranchRow,
  index: number,
  count: number
): string | undefined {
  if (row.titleOverride !== undefined) return row.titleOverride
  return row.titleMissing ? undefined : positionalTitle(kind, index, count)
}

/** The title the canvas shows (condition-input.tsx). */
function positionalTitle(kind: CanonicalBranches['kind'], index: number, count: number): string {
  if (kind === 'router') return `Route ${index + 1}`
  if (index === 0) return 'if'
  if (index === count - 1) return 'else'
  return 'else if'
}

/**
 * Ids a never-persisted (or unparseable, or empty) branch list answers to, keyed by default key:
 * `getConditionRows` / `getRouterRows` fallbacks.
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

function keyByRowIdOf(ids: Record<BranchKey, string>): Map<string, BranchKey> {
  return new Map(Object.entries(ids).map(([key, id]) => [id, key]))
}

function withImplicit(
  kind: CanonicalBranches['kind'],
  blockId: string,
  rows: CanonicalBranchRow[] | null
): LiftedBranches {
  const ids = implicitIds(kind, blockId)
  return { branches: { kind, rows }, ids, keyByRowId: keyByRowIdOf(ids) }
}

/**
 * The ids a stored branch value that cannot be lifted answers to: none when it is a JSON list
 * (of something other than rows), else the implicit ids, as for a never-persisted value.
 */
export function unliftedBranchIds(
  kind: CanonicalBranches['kind'],
  blockId: string,
  stored: unknown
): Record<BranchKey, string> {
  return parseStoredList(stored) ? {} : implicitIds(kind, blockId)
}

function unlifted(
  kind: CanonicalBranches['kind'],
  blockId: string,
  stored: unknown
): LiftedBranches {
  const ids = unliftedBranchIds(kind, blockId, stored)
  return {
    branches: { kind, rows: null },
    ids,
    keyByRowId: keyByRowIdOf(ids),
    unliftedValue: stored,
  }
}

/**
 * Lifts the `conditions` / `routes` subBlock into named branches.
 * Keys resolve lock (by row id) → persisted row `key` → positional default; a key
 * already taken gets a `_n` suffix. UI state is stripped, a stored title that differs from the
 * positional one becomes `titleOverride` (condition titles are semantic: the executor finds
 * `else` by title, `isElseConditionTitle`). A never-persisted value is `rows: null` and answers
 * to the implicit ids. A value that is not a list of `{ id?, title?, value }` rows with distinct
 * ids (stored or derived) is returned as `unliftedValue` for the caller to keep verbatim, since
 * the lock holds one key per row id.
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

  const storedRows = parseStoredList(stored)
  if (!storedRows) {
    if (typeof stored !== 'string' || stored.trim() !== '') {
      context.diagnostics.push(
        diagnostic(
          'W_CANON_UNDECODABLE_JSON',
          `Stored ${kind} branches are not a JSON list; kept verbatim`,
          {
            blockKey,
            param,
          }
        )
      )
    }
    return unlifted(kind, blockId, stored)
  }
  if (!storedRows.every(isStoredRow)) {
    context.diagnostics.push(
      diagnostic(
        'W_CANON_UNDECODABLE_JSON',
        `Stored ${kind} branches are not a list of { id, title, value } rows; kept verbatim`,
        {
          blockKey,
          param,
        }
      )
    )
    return unlifted(kind, blockId, stored)
  }
  if (storedRows.length === 0) return withImplicit(kind, blockId, [])

  const count = storedRows.length
  const rowIds = storedRows.map((row, index) => row.id ?? derivedRowId(kind, blockId, index))
  const seenRowIds = new Set<string>()
  const sharedId = rowIds.find((rowId) => {
    if (seenRowIds.has(rowId)) return true
    seenRowIds.add(rowId)
    return false
  })
  if (sharedId !== undefined) {
    context.diagnostics.push(
      diagnostic(
        'W_CANON_UNDECODABLE_JSON',
        `Stored ${kind} branches use row id "${sharedId}" twice; kept verbatim`,
        {
          blockKey,
          param,
        }
      )
    )
    return unlifted(kind, blockId, stored)
  }
  const keys: Array<BranchKey | undefined> = new Array(count)
  const taken = new Set<BranchKey>()

  rowIds.forEach((rowId, index) => {
    const key = lockKeyByRowId.get(rowId)
    if (key !== undefined && isIdentifierName(key) && !taken.has(key)) {
      keys[index] = key
      taken.add(key)
    }
  })
  storedRows.forEach((row, index) => {
    if (keys[index] !== undefined) return
    const key = row.key
    if (typeof key === 'string' && isIdentifierName(key) && !taken.has(key)) {
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
        context.diagnostics.push(
          diagnostic(
            'W_CANON_TITLE_OVERRIDE',
            `Branch ${index + 1} is titled "${stored.title}" but shows as "${positional}"; the executor matches else by stored title`,
            {
              blockKey,
              param,
            }
          )
        )
      }
    }
    const extra: Record<string, Json> = {}
    for (const [field, value] of Object.entries(stored)) {
      if (!isBranchExtraField(field) || value === undefined) continue
      setOwn(extra, field, toJson(value))
    }
    if (Object.keys(extra).length > 0) row.extra = extra
    rows.push(row)
    setOwn(ids, key, rowIds[index])
    if (!keyByRowId.has(rowIds[index])) keyByRowId.set(rowIds[index], key)
  })
  return { branches: { kind, rows }, ids, keyByRowId }
}
