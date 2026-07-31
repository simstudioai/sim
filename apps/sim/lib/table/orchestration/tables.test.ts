/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockDeleteTable, mockDeleteRow, mockCaptureServerEvent } = vi.hoisted(() => ({
  mockDeleteTable: vi.fn(),
  mockDeleteRow: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({ deleteTable: mockDeleteTable }))
vi.mock('@/lib/table/rows/service', () => ({ deleteRow: mockDeleteRow }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { TableLockedError } from '@/lib/table/mutation-locks'
import { performDeleteTable, performDeleteTableRow } from '@/lib/table/orchestration/tables'

const TABLE = { id: 'table-1', name: 'Tasks', workspaceId: 'ws-1' } as unknown as TableDefinition

describe('performDeleteTable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hands the actor to the service so it owns the audit', async () => {
    // deleteTable audits only when a row was actually archived AND an actor is
    // given. Callers that omitted the actor and audited themselves emitted
    // TABLE_DELETED for a no-op delete of an already-archived table.
    mockDeleteTable.mockResolvedValue(undefined)

    const result = await performDeleteTable({ table: TABLE, userId: 'user-1', requestId: 'req-1' })

    expect(result.success).toBe(true)
    expect(mockDeleteTable).toHaveBeenCalledWith('table-1', 'req-1', 'user-1')
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'table_deleted',
      expect.objectContaining({ table_id: 'table-1' }),
      expect.anything()
    )
  })

  it('classifies a delete lock as locked and emits no telemetry', async () => {
    mockDeleteTable.mockRejectedValue(new TableLockedError('delete'))

    const result = await performDeleteTable({ table: TABLE, userId: 'user-1' })

    expect(result).toMatchObject({ success: false, errorCode: 'locked' })
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('performDeleteTableRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes through the row service so the lock and bookkeeping apply', async () => {
    mockDeleteRow.mockResolvedValue(undefined)

    const result = await performDeleteTableRow({ table: TABLE, rowId: 'row-1', requestId: 'req-1' })

    expect(result.success).toBe(true)
    expect(mockDeleteRow).toHaveBeenCalledWith(TABLE, 'row-1', 'req-1')
  })

  it('classifies a delete lock as locked', async () => {
    mockDeleteRow.mockRejectedValue(new TableLockedError('delete'))

    expect((await performDeleteTableRow({ table: TABLE, rowId: 'row-1' })).errorCode).toBe('locked')
  })

  it('classifies a missing row as not_found', async () => {
    mockDeleteRow.mockRejectedValue(new Error('Row not found'))

    expect((await performDeleteTableRow({ table: TABLE, rowId: 'row-1' })).errorCode).toBe(
      'not_found'
    )
  })
})
