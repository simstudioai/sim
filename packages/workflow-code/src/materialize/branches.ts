import { positionalKeys, storedTitle } from '../canonicalize/branches'
import type { BranchKey, CanonicalBranches, CanonicalBranchRow } from '../model'
import { getOwn, setOwn } from '../records'
import type { MaterializeContext } from './context'
import { sharesEvidence, soleRename } from './rename'

interface BranchWrite {
  /** The stored subBlock value: JSON text, or `null` for never-persisted rows. */
  value: string | null
  /** Branch key → row id, as written. */
  ids: Record<BranchKey, string>
}

/**
 * Writes condition/router rows. Each row keeps the id its key
 * had (the lock's, then prev's, including the implicit `${blockId}-if` a never-persisted list
 * answered to). When exactly one row's key is new and exactly one known id's key is gone, and
 * `prevRows` held that key with the same expression, the row is a renamed branch and keeps the
 * id, so its edges stay; any other new row gets `${blockId}-${newId()}`, which keeps
 * `remapConditionBlockIds` working. Titles are positional unless the row overrides one or stored
 * none. The row `key` is persisted only when it differs from the positional default, so a lockless
 * read gets the same keys back. `rows: null` stays `null`. The list is always text: the
 * canvas reads it with `toString()` and a stored array breaks it (condition-input.tsx).
 */
export function writeBranches(
  branches: CanonicalBranches,
  blockId: string,
  knownIds: ReadonlyArray<Record<BranchKey, string> | undefined>,
  prevRows: readonly CanonicalBranchRow[] | null | undefined,
  context: MaterializeContext
): BranchWrite {
  if (branches.rows === null) return { value: null, ids: {} }
  const rows = branches.rows
  const defaults = positionalKeys(branches.kind, rows.length)
  const used = new Set<string>()
  const knownRowIds = rows.map((row) => {
    const known = knownIds
      .map((source) => (source ? getOwn(source, row.key) : undefined))
      .find((id): id is string => id !== undefined && !used.has(id))
    if (known !== undefined) used.add(known)
    return known
  })
  const renamed = renamedRowId(rows, knownRowIds, knownIds, prevRows ?? [], used)
  const ids: Record<BranchKey, string> = {}
  const stored = rows.map((row, index) => {
    const id =
      knownRowIds[index] ??
      (renamed?.index === index ? renamed.id : `${blockId}-${context.hooks.newId()}`)
    used.add(id)
    setOwn(ids, row.key, id)
    const entry: Record<string, unknown> = { id }
    const title = storedTitle(branches.kind, row, index, rows.length)
    if (title !== undefined) entry.title = title
    entry.value = row.value
    if (row.key !== defaults[index]) entry.key = row.key
    for (const [field, value] of Object.entries(row.extra ?? {})) setOwn(entry, field, value)
    return entry
  })
  return { value: JSON.stringify(stored), ids }
}

/**
 * The one row a lone branch key rename left without a known id, with its id, when the prev row
 * under the former key held the same expression (see {@link soleRename}).
 */
function renamedRowId(
  rows: readonly CanonicalBranchRow[],
  knownRowIds: ReadonlyArray<string | undefined>,
  knownIds: ReadonlyArray<Record<BranchKey, string> | undefined>,
  prevRows: readonly CanonicalBranchRow[],
  used: ReadonlySet<string>
): { index: number; id: string } | null {
  const keys = new Set(rows.map((row) => row.key))
  const orphans = new Map<string, BranchKey>()
  for (const source of knownIds) {
    for (const [key, id] of Object.entries(source ?? {})) {
      if (!keys.has(key) && !used.has(id)) orphans.set(id, key)
    }
  }
  const renamed = soleRename(
    knownRowIds.flatMap((id, index) => (id === undefined ? [index] : [])),
    [...orphans],
    (index, formerKey) => {
      const former = prevRows.find((row) => row.key === formerKey)
      const row = rows[index]
      return former !== undefined && row !== undefined && sharesEvidence(former, row, ['value'])
    }
  )
  return renamed && { index: renamed.item, id: renamed.id }
}
