/**
 * Single source of truth for lock vocabulary shared by the lock settings modal
 * and the lock toasts (the on-open announcement and blocked actions). Kept out of
 * `lib/table/mutation-locks.ts` — that module is server-tainted (importing it
 * from a client component pulls `next/headers` into the browser bundle).
 */

import type { TableLockKind, TableLocks } from '@/lib/table/types'

export interface LockField {
  /** The `TableLocks` flag this row controls. */
  key: keyof TableLocks
  kind: TableLockKind
  /** The action being locked, phrased to read inside a list. */
  noun: string
  label: string
  hint: string
}

export const LOCK_FIELDS: LockField[] = [
  {
    key: 'insertLocked',
    kind: 'insert',
    noun: 'adding rows',
    label: 'Inserting Rows',
    hint: 'Allow new rows to be added, including through CSV imports, the API, workflows, and Sim. Deny blocks new rows when Table Security is enabled.',
  },
  {
    key: 'updateLocked',
    kind: 'update',
    noun: 'editing rows',
    label: 'Updating Rows',
    hint: 'Allow existing cell values to be changed. Deny blocks edits when Table Security is enabled. Workflow and enrichment columns still populate.',
  },
  {
    key: 'deleteLocked',
    kind: 'delete',
    noun: 'deleting rows',
    label: 'Deleting Rows',
    hint: 'Allow rows to be deleted and the table to be archived. Deny blocks these actions and destructive column changes when Table Security is enabled.',
  },
  {
    key: 'schemaLocked',
    kind: 'schema',
    noun: 'changing columns',
    label: 'Changing Table Schema',
    hint: 'Allow columns to be added, renamed, retyped, or removed. Deny blocks schema changes when Table Security is enabled. Removing or retyping columns also requires Deleting Rows to be set to Allow.',
  },
]

/** The locked verbs' nouns, in display order. Empty when nothing is locked. */
export function lockedNouns(locks: TableLocks): string[] {
  return LOCK_FIELDS.filter((f) => locks[f.key]).map((f) => f.noun)
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
        title: 'Table Security',
        text:
          nouns.length > 0
            ? `An admin has locked ${nouns.join(', ')} on this table.`
            : 'Nothing is locked on this table.',
      }
    }
  }
}
