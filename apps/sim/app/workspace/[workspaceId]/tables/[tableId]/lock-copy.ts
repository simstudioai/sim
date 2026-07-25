/**
 * Single source of truth for lock vocabulary shared by the lock settings modal,
 * the locked-action modal, and the table header chip. Kept out of
 * `lib/table/mutation-locks.ts` — that module is server-tainted (importing it
 * from a client component pulls `next/headers` into the browser bundle).
 */

import type { TableLockKind, TableLocks } from '@/lib/table/types'

export interface LockField {
  /** The `TableLocks` flag this row toggles. */
  key: keyof TableLocks
  kind: TableLockKind
  /** The action being locked, phrased to read after "Lock " and inside a list. */
  noun: string
  hint: string
}

export const LOCK_FIELDS: LockField[] = [
  {
    key: 'insertLocked',
    kind: 'insert',
    noun: 'adding rows',
    hint: 'On: no new rows can be added — by anyone, including CSV import, the API, workflow blocks, and Sim.',
  },
  {
    key: 'updateLocked',
    kind: 'update',
    noun: 'editing rows',
    hint: 'On: existing cell values cannot be changed. Workflow and enrichment columns still populate.',
  },
  {
    key: 'deleteLocked',
    kind: 'delete',
    noun: 'deleting rows',
    hint: 'On: rows cannot be deleted, and the table cannot be archived.',
  },
  {
    key: 'schemaLocked',
    kind: 'schema',
    noun: 'changing columns',
    hint: 'On: columns cannot be added, renamed, retyped, or removed.',
  },
]

/** The locked verbs' nouns, in display order. Empty when nothing is locked. */
export function lockedNouns(locks: TableLocks): string[] {
  return LOCK_FIELDS.filter((f) => locks[f.key]).map((f) => f.noun)
}

/**
 * Plain-language summary of a lock set — the named mode when the combination
 * matches one, otherwise a list of what is locked.
 */
export function describeLocks(locks: TableLocks): { name: string; detail: string } {
  const locked = lockedNouns(locks)
  if (locked.length === 0) {
    return { name: 'Unlocked', detail: 'anyone with edit access can change this table.' }
  }
  if (locked.length === LOCK_FIELDS.length) {
    return { name: 'Read-only', detail: 'no one can change this table’s rows or columns.' }
  }
  if (!locks.insertLocked && locks.updateLocked && locks.deleteLocked) {
    return { name: 'Append-only', detail: 'rows can be added, but not edited or deleted.' }
  }
  return { name: 'Locked', detail: `${locked.join(', ')} locked.` }
}
