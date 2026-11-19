import { positionalKeys, positionalTitle } from '../canonicalize/branches'
import type { BranchKey, CanonicalBranches } from '../model'
import { getOwn, setOwn } from '../records'
import type { MaterializeContext } from './context'

interface BranchWrite {
  /** The stored subBlock value: JSON text, or `null` for never-persisted rows. */
  value: string | null
  /** Branch key → row id, as written. */
  ids: Record<BranchKey, string>
}

/**
 * Writes condition/router rows. Each row keeps the id its key
 * had (the lock's, then prev's, including the implicit `${blockId}-if` a never-persisted list
 * answered to); a new row gets `${blockId}-${newId()}`, which keeps `remapConditionBlockIds`
 * working. Titles are positional unless the row overrides one or stored
 * none. The row `key` is persisted only when it differs from the positional default, so a lockless
 * read gets the same keys back. `rows: null` stays `null`. The list is always text: the
 * canvas reads it with `toString()` and a stored array breaks it (condition-input.tsx).
 */
export function writeBranches(
  branches: CanonicalBranches,
  blockId: string,
  knownIds: ReadonlyArray<Record<BranchKey, string> | undefined>,
  context: MaterializeContext
): BranchWrite {
  if (branches.rows === null) return { value: null, ids: {} }
  const rows = branches.rows
  const defaults = positionalKeys(branches.kind, rows.length)
  const used = new Set<string>()
  const ids: Record<BranchKey, string> = {}
  const stored = rows.map((row, index) => {
    const known = knownIds
      .map((source) => (source ? getOwn(source, row.key) : undefined))
      .find((id): id is string => id !== undefined && !used.has(id))
    const id = known ?? `${blockId}-${context.hooks.newId()}`
    used.add(id)
    setOwn(ids, row.key, id)
    const entry: Record<string, unknown> = { id }
    if (row.titleOverride !== undefined) entry.title = row.titleOverride
    else if (!row.titleMissing) entry.title = positionalTitle(branches.kind, index, rows.length)
    entry.value = row.value
    if (row.key !== defaults[index]) entry.key = row.key
    for (const [field, value] of Object.entries(row.extra ?? {})) setOwn(entry, field, value)
    return entry
  })
  return { value: JSON.stringify(stored), ids }
}
