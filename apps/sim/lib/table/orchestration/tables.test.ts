/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockDeleteTable, mockDeleteRow, mockRenameTable, mockCaptureServerEvent, mockRecordAudit } =
  vi.hoisted(() => ({
    mockDeleteTable: vi.fn(),
    mockDeleteRow: vi.fn(),
    mockRenameTable: vi.fn(),
    mockCaptureServerEvent: vi.fn(),
    mockRecordAudit: vi.fn(),
  }))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_DELETED: 'table.deleted', TABLE_UPDATED: 'table.updated' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/table/service', () => ({
  deleteTable: mockDeleteTable,
  moveTableToFolder: vi.fn(),
  renameTable: mockRenameTable,
  updateTableLocks: vi.fn(),
}))
vi.mock('@/lib/table/rows/service', () => ({ deleteRow: mockDeleteRow }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableLockedError } from '@/lib/table/mutation-locks'
import {
  performDeleteTable,
  performDeleteTableRow,
  performRenameTable,
} from '@/lib/table/orchestration/tables'

const TABLE = { id: 'table-1', name: 'Tasks', workspaceId: 'ws-1' } as unknown as TableDefinition

describe('performDeleteTable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('audits a genuine archive against the acting user', async () => {
    mockDeleteTable.mockResolvedValue({ archived: { name: 'Tasks', workspaceId: 'ws-1' } })

    const result = await performDeleteTable({ table: TABLE, userId: 'user-1', requestId: 'req-1' })

    expect(result.success).toBe(true)
    // The service no longer takes an actor — auditing follows from a user
    // performing the operation, not from which function the caller reached for.
    expect(mockDeleteTable).toHaveBeenCalledWith('table-1', 'req-1')
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1', resourceId: 'table-1' })
    )
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'table_deleted',
      expect.objectContaining({ table_id: 'table-1' }),
      expect.anything()
    )
  })

  it('carries request provenance into the audit row', async () => {
    mockDeleteTable.mockResolvedValue({ archived: { name: 'Tasks', workspaceId: 'ws-1' } })
    const request = new Request('https://sim.ai', { headers: { 'user-agent': 'curl/8' } })

    await performDeleteTable({ table: TABLE, userId: 'user-1', request })

    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ request }))
  })

  it('neither audits nor reports a repeat delete of an already-archived table', async () => {
    mockDeleteTable.mockResolvedValue({ archived: null })

    const result = await performDeleteTable({ table: TABLE, userId: 'user-1' })

    expect(result.success).toBe(true)
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('classifies a delete lock as locked and emits no telemetry', async () => {
    mockDeleteTable.mockRejectedValue(new TableLockedError('delete'))

    const result = await performDeleteTable({ table: TABLE, userId: 'user-1' })

    expect(result).toMatchObject({ success: false, errorCode: 'locked', lock: 'delete' })
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('performRenameTable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies a name collision as a conflict, not bad input', async () => {
    // `TableConflictError` is an `OrchestrationError('conflict')` — the class
    // decides the status, so the 409 no longer rides on the message wording.
    mockRenameTable.mockRejectedValue(
      new OrchestrationError('conflict', 'A table named "Tasks" already exists in this workspace')
    )

    const result = await performRenameTable({ table: TABLE, newName: 'Tasks', userId: 'user-1' })

    expect(result).toMatchObject({ success: false, errorCode: 'conflict' })
  })

  it('keeps an unclassified rename failure internal', async () => {
    mockRenameTable.mockRejectedValue(new Error('A table named "Tasks" already exists'))

    expect(
      (await performRenameTable({ table: TABLE, newName: 'Tasks', userId: 'user-1' })).errorCode
    ).toBe('internal')
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

    const rowResult = await performDeleteTableRow({ table: TABLE, rowId: 'row-1' })
    expect(rowResult.errorCode).toBe('locked')
    // The kind rides along so the route can name which flag to clear.
    expect(rowResult.lock).toBe('delete')
  })

  it('classifies a missing row as not_found', async () => {
    mockDeleteRow.mockRejectedValue(new OrchestrationError('not_found', 'Row not found'))

    expect((await performDeleteTableRow({ table: TABLE, rowId: 'row-1' })).errorCode).toBe(
      'not_found'
    )
  })
})
