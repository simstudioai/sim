/**
 * @vitest-environment node
 *
 * `updateColumnOptions` is the one column mutator whose lock gating depends on
 * the payload: every call is a schema change, and a call that drops options also
 * rewrites cells. Both halves are asserted here because an options-only payload
 * is the shape that reaches this mutator from `PATCH .../columns`, and it used
 * to be the single column write with no lock assert at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition, TableLocks } from '@/lib/table/types'

const { mockWithLockedTable } = vi.hoisted(() => ({ mockWithLockedTable: vi.fn() }))

vi.mock('@/lib/table/service', () => ({ withLockedTable: mockWithLockedTable }))

import { updateColumnOptions } from '@/lib/table/columns/service'

const UNLOCKED: TableLocks = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}

const COLUMN = {
  id: 'col_status',
  name: 'Status',
  type: 'select' as const,
  options: [
    { id: 'opt_open', name: 'Open' },
    { id: 'opt_done', name: 'Done' },
  ],
}

function makeTable(locks: Partial<TableLocks>): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'Tasks',
    schema: { columns: [COLUMN] },
    rowCount: 3,
    maxRows: 100,
    workspaceId: 'ws_1',
    createdBy: 'user_1',
    locks: { ...UNLOCKED, ...locks },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as TableDefinition
}

/**
 * Any transaction use is a failure: every assert under test must fire before the
 * mutator touches the database, so the stub has no usable surface.
 */
const FORBIDDEN_TRX = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`Transaction used after a lock assert should have refused: ${String(prop)}`)
    },
  }
)

function runWith(table: TableDefinition, options: Array<{ id: string; name: string }>) {
  mockWithLockedTable.mockImplementation(
    async (_tableId: string, mutate: (t: TableDefinition, trx: unknown) => Promise<unknown>) =>
      mutate(table, FORBIDDEN_TRX)
  )
  return updateColumnOptions({ tableId: 'tbl_1', columnName: 'Status', options }, 'req-1')
}

describe('updateColumnOptions lock gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses an options-only edit on a schema-locked table', async () => {
    await expect(
      runWith(makeTable({ schemaLocked: true }), [
        ...COLUMN.options,
        { id: 'opt_new', name: 'New' },
      ])
    ).rejects.toMatchObject({ statusCode: 423, lock: 'schema' })
  })

  it('refuses an option REMOVAL on a delete-locked table', async () => {
    await expect(
      runWith(makeTable({ deleteLocked: true }), [{ id: 'opt_open', name: 'Open' }])
    ).rejects.toMatchObject({ statusCode: 423, lock: 'delete' })
  })

  it('lets a delete-locked table add an option, which clears no cell', async () => {
    await expect(
      runWith(makeTable({ deleteLocked: true }), [
        ...COLUMN.options,
        { id: 'opt_new', name: 'New' },
      ])
    ).rejects.toThrow(/Transaction used/)
  })
})
