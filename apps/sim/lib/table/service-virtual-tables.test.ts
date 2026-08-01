/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListVirtualTables } = vi.hoisted(() => ({
  mockListVirtualTables: vi.fn(),
}))

vi.mock('@/lib/virtual-tables/service.server', () => ({
  listVirtualTables: mockListVirtualTables,
}))

vi.mock('@/lib/table/jobs/service', () => ({
  EMPTY_JOB_FIELDS: {
    jobStatus: null,
    jobId: null,
    jobType: null,
    jobError: null,
    jobRowsProcessed: 0,
    pendingDeleteRemaining: 0,
  },
  latestJobForTable: vi.fn(),
  latestJobsForTables: vi.fn(() => Promise.resolve(new Map())),
}))

import { listTables } from '@/lib/table/service'

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

describe('listTables virtual table composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('combines persisted and virtual definitions for the active scope', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [
      {
        id: 'table-1',
        name: 'People',
        description: null,
        schema: { columns: [] },
        metadata: null,
        maxRows: 100,
        workspaceId: 'workspace-1',
        folderId: null,
        createdBy: 'user-1',
        archivedAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        rowCount: 2,
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
      },
    ])
    const memoryTable = { id: 'system_memory_workspace-1', isVirtual: true }
    mockListVirtualTables.mockResolvedValue([memoryTable])

    const tables = await listTables('workspace-1', { scope: 'active' })

    expect(tables.map((table) => table.id)).toEqual(['table-1', 'system_memory_workspace-1'])
    expect(mockListVirtualTables).toHaveBeenCalledWith('workspace-1', { scope: 'active' })
  })

  it('does not add virtual definitions to the archived scope', async () => {
    queueTableRows(schemaMock.userTableDefinitions, [])
    mockListVirtualTables.mockResolvedValue([])

    await expect(listTables('workspace-1', { scope: 'archived' })).resolves.toEqual([])
    expect(mockListVirtualTables).toHaveBeenCalledWith('workspace-1', { scope: 'archived' })
  })
})
