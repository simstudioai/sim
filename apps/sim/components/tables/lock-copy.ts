/**
 * Single source of truth for lock vocabulary shared by the Table Security modal
 * and the lock toasts (the on-open announcement and blocked actions). Kept out of
 * `lib/table/mutation-locks.ts` — that module is server-tainted (importing it
 * from a client component pulls `next/headers` into the browser bundle).
 *
 * The modal speaks Allow/Deny, so this copy does too: a set lock reads as its
 * action being "disabled", never as a separate "locked" state.
 */

import type { TableLockKind, TableLocks } from '@/lib/table/types'

export interface LockField {
  /** The `TableLocks` flag this row controls. */
  key: keyof TableLocks
  kind: TableLockKind
  /** The action being denied, phrased to read inside a list. */
  noun: string
  label: string
  hint: string
}

export const LOCK_FIELDS: LockField[] = [
  {
    key: 'insertLocked',
    kind: 'insert',
    noun: 'inserting rows',
    label: 'Inserting Rows',
    hint: 'Allow new rows to be added, including through CSV imports, the API, workflows, and Sim. Deny blocks new rows from every surface.',
  },
  {
    key: 'updateLocked',
    kind: 'update',
    noun: 'updating rows',
    label: 'Updating Rows',
    hint: 'Allow existing cell values to be changed. Deny blocks edits from every surface. Workflow and enrichment columns still populate.',
  },
  {
    key: 'deleteLocked',
    kind: 'delete',
    noun: 'deleting rows',
    label: 'Deleting Rows',
    hint: 'Allow rows to be deleted and the table to be archived. Deny blocks those actions and destructive column changes.',
  },
  {
    key: 'schemaLocked',
    kind: 'schema',
    noun: 'changing the table schema',
    label: 'Changing Table Schema',
    hint: 'Allow columns to be added, renamed, retyped, or removed. Deny blocks schema changes. Removing or retyping columns also requires Deleting Rows set to Allow.',
  },
]

/**
 * Tooltip for a control a denied action disables. One sentence per lock kind so
 * the grid chrome (New row, New column, the column menu, the expanded editor's
 * Save) all name the same Table Security row.
 */
export const LOCK_TOOLTIPS: Record<TableLockKind, string> = {
  insert: 'Inserting rows is disabled in Table Security.',
  update: 'Updating rows is disabled in Table Security.',
  delete: 'Deleting rows is disabled in Table Security.',
  schema: 'Changing the table schema is disabled in Table Security.',
}

/** The denied actions' nouns, in display order. Empty when everything is allowed. */
export function lockedNouns(locks: TableLocks): string[] {
  return LOCK_FIELDS.filter((f) => locks[f.key]).map((f) => f.noun)
}

/**
 * Why a locked-table notice was raised. `'status'` is the informational case
 * (the announcement shown once when a restricted table is opened); the rest are
 * actions the user just tried and couldn't do.
 */
export type BlockedTableAction = 'add-row' | 'add-column' | 'delete-column' | 'edit-cell' | 'status'

/**
 * Copy for the action the user attempted, in the modal's vocabulary: each
 * notice names the Table Security row that denies it, so the reader knows which
 * setting an admin has to flip.
 */
export function describeBlockedAction(
  action: BlockedTableAction,
  locks: TableLocks
): { title: string; text: string } {
  switch (action) {
    case 'add-row':
      return {
        title: 'Inserting rows is disabled',
        text: 'An admin has set Inserting Rows to Deny in Table Security.',
      }
    case 'add-column':
      return {
        title: 'Changing the table schema is disabled',
        text: 'An admin has set Changing Table Schema to Deny in Table Security, so columns can’t be added, renamed, retyped, or removed.',
      }
    case 'delete-column':
      // Reachable with Changing Table Schema on Allow but Deleting Rows on Deny —
      // removing a column clears its value from every row, so it needs both.
      return locks.schemaLocked
        ? {
            title: 'Changing the table schema is disabled',
            text: 'An admin has set Changing Table Schema to Deny in Table Security, so columns can’t be added, renamed, retyped, or removed.',
          }
        : {
            title: 'Deleting rows is disabled',
            text: 'Removing a column clears its value from every row, so it needs Deleting Rows set to Allow in Table Security.',
          }
    case 'edit-cell':
      return {
        title: 'Updating rows is disabled',
        text: 'An admin has set Updating Rows to Deny in Table Security.',
      }
    case 'status': {
      const nouns = lockedNouns(locks)
      return {
        title: 'Table Security',
        text:
          nouns.length > 0
            ? `An admin has set ${nouns.join(', ')} to Deny on this table.`
            : 'Every action is allowed on this table.',
      }
    }
  }
}
