/**
 * Single source of truth for lock vocabulary shared by the lock settings modal
 * and the lock toasts (the on-open announcement and blocked actions). Kept out of
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
  // Append-only describes the row semantics — adding is the only thing left.
  // A schema lock on top doesn't change that, so it keeps the name and is
  // called out in the detail rather than demoted to the generic case.
  if (!locks.insertLocked && locks.updateLocked && locks.deleteLocked) {
    return {
      name: 'Append-only',
      detail: locks.schemaLocked
        ? 'rows can be added, but not edited or deleted, and columns are locked.'
        : 'rows can be added, but not edited or deleted.',
    }
  }
  return { name: 'Locked', detail: `${locked.join(', ')} locked.` }
}

/**
 * Why a locked-table notice was raised. `'status'` is the informational case
 * (the announcement shown once when a locked table is opened); the rest are
 * actions the user just tried and couldn't do.
 */
export type BlockedTableAction = 'add-row' | 'add-column' | 'delete-column' | 'edit-cell' | 'status'

/**
 * Copy for the action the user attempted. Explains what is blocked and — for
 * the append-only manual-entry case — what to do instead, since that one is
 * blocked by the *update* lock rather than the insert lock.
 */
export function describeBlockedAction(
  action: BlockedTableAction,
  locks: TableLocks
): { title: string; text: string } {
  switch (action) {
    case 'add-row':
      if (locks.insertLocked) {
        return {
          title: 'Adding rows is locked',
          text: 'No new rows can be added until an admin unlocks this table.',
        }
      }
      return {
        title: 'This table is append-only',
        text: 'Rows can’t be edited once added, so typing one into the grid is unavailable. Import a CSV, or add rows from the API, a workflow, or Sim.',
      }
    case 'add-column':
      return {
        title: 'Changing columns is locked',
        text: 'Columns can’t be added, renamed, retyped, or removed until an admin unlocks this table.',
      }
    case 'delete-column':
      // Reachable with the schema lock off but the delete lock on — removing a
      // column clears its value from every row, so it needs both.
      return locks.schemaLocked
        ? {
            title: 'Changing columns is locked',
            text: 'Columns can’t be added, renamed, retyped, or removed until an admin unlocks this table.',
          }
        : {
            title: 'Deleting columns is locked',
            text: 'Removing a column deletes its value from every row, so it’s blocked while deleting is locked.',
          }
    case 'edit-cell':
      return {
        title: 'Editing rows is locked',
        text: 'Existing cell values can’t be changed until an admin unlocks this table.',
      }
    case 'status': {
      const nouns = lockedNouns(locks)
      return {
        title: 'Table locks',
        text:
          nouns.length > 0
            ? `An admin has locked ${nouns.join(', ')} on this table.`
            : 'Nothing is locked on this table.',
      }
    }
  }
}
