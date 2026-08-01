/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { TableLocks } from '@/lib/table/types'
import { describeBlockedAction, describeLocks, lockedNouns } from './lock-copy'

const READ_ONLY_LOCKS: TableLocks = {
  schemaLocked: true,
  insertLocked: true,
  updateLocked: true,
  deleteLocked: true,
}

describe('describeBlockedAction', () => {
  it('describes virtual tables as read-only without suggesting an admin can unlock them', () => {
    expect(describeBlockedAction('edit-cell', READ_ONLY_LOCKS, true)).toEqual({
      title: 'This table is read-only',
      text: 'Its rows and columns can be viewed, but they can’t be changed.',
    })
  })

  it('describes blocked operations from locks alone', () => {
    expect(describeBlockedAction('edit-cell', READ_ONLY_LOCKS)).toEqual({
      title: 'Editing rows is locked',
      text: 'Existing cell values can’t be changed until an admin unlocks this table.',
    })
    expect(describeBlockedAction('add-column', READ_ONLY_LOCKS)).toEqual({
      title: 'Changing columns is locked',
      text: 'Columns can’t be added, renamed, retyped, or removed until an admin unlocks this table.',
    })
    expect(describeBlockedAction('delete-column', READ_ONLY_LOCKS)).toEqual({
      title: 'Changing columns is locked',
      text: 'Columns can’t be added, renamed, retyped, or removed until an admin unlocks this table.',
    })
    expect(describeBlockedAction('add-row', READ_ONLY_LOCKS)).toEqual({
      title: 'Adding rows is locked',
      text: 'No new rows can be added until an admin unlocks this table.',
    })
  })

  it('preserves append-only and delete-lock explanations', () => {
    const appendOnly: TableLocks = {
      schemaLocked: false,
      insertLocked: false,
      updateLocked: true,
      deleteLocked: true,
    }

    expect(describeBlockedAction('add-row', appendOnly).title).toBe('This table is append-only')
    expect(describeBlockedAction('delete-column', appendOnly)).toEqual({
      title: 'Deleting columns is locked',
      text: 'Removing a column deletes its value from every row, so it’s blocked while deleting is locked.',
    })
  })

  it('describes informational lock status', () => {
    expect(describeBlockedAction('status', READ_ONLY_LOCKS).title).toBe('Table locks')
    expect(
      describeBlockedAction('status', {
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
      }).text
    ).toBe('Nothing is locked on this table.')
  })
})

describe('lock summaries', () => {
  it('lists and summarizes lock combinations', () => {
    const unlocked: TableLocks = {
      schemaLocked: false,
      insertLocked: false,
      updateLocked: false,
      deleteLocked: false,
    }
    const appendOnly: TableLocks = {
      schemaLocked: false,
      insertLocked: false,
      updateLocked: true,
      deleteLocked: true,
    }

    expect(lockedNouns(READ_ONLY_LOCKS)).toEqual([
      'adding rows',
      'editing rows',
      'deleting rows',
      'changing columns',
    ])
    expect(describeLocks(unlocked).name).toBe('Unlocked')
    expect(describeLocks(READ_ONLY_LOCKS).name).toBe('Read-only')
    expect(describeLocks(appendOnly).name).toBe('Append-only')
    expect(describeLocks({ ...appendOnly, schemaLocked: true }).detail).toContain(
      'columns are locked'
    )
    expect(describeLocks({ ...unlocked, schemaLocked: true }).name).toBe('Locked')
  })
})
