import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableLockedError } from '@/lib/table/mutation-locks'
import {
  performDeleteTable,
  performDeleteTableRow,
  performRenameTable,
} from '@/lib/table/orchestration/tables'

const mockDeleteRow = tableRowsServiceMockFns.mockDeleteRow

const mockDeleteTable = tableServiceMockFns.mockDeleteTable
const mockRenameTable = tableServiceMockFns.mockRenameTable
const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent
const mockRecordAudit = auditMockFns.mockRecordAudit

const TABLE = { id: 'table-1', name: 'Tasks', workspaceId: 'ws-1' } as unknown as TableDefinition

describe('performDeleteTable', () => {
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
  it('classifies a name collision as a conflict, not bad input', async () => {
    // `TableConflictError` is an `OrchestrationError('conflict')` — the class
    // decides the status, so the 409 no longer rides on the message wording.
    mockRenameTable.mockRejectedValue(
      new OrchestrationError('conflict', 'A table named "Tasks" already exists in this workspace')
    )

    const result = await performRenameTable({ table: TABLE, newName: 'Tasks', userId: 'user-1' })

    expect(result).toMatchObject({ success: false, errorCode: 'conflict' })
  })
})

describe('performDeleteTableRow', () => {
  it('classifies a delete lock as locked', async () => {
    mockDeleteRow.mockRejectedValue(new TableLockedError('delete'))

    const rowResult = await performDeleteTableRow({ table: TABLE, rowId: 'row-1' })
    expect(rowResult.errorCode).toBe('locked')
    // The kind rides along so the route can name which flag to clear.
    expect(rowResult.lock).toBe('delete')
  })
})
