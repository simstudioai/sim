/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const {
  mockResolveWorkspaceFileReference,
  mockDownloadWorkspaceFile,
  mockGetTableById,
  mockBatchInsertRows,
  mockReplaceTableRows,
} = vi.hoisted(() => ({
  mockResolveWorkspaceFileReference: vi.fn(),
  mockDownloadWorkspaceFile: vi.fn(),
  mockGetTableById: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockReplaceTableRows: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('deadbeefcafef00d'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
  fetchWorkspaceFileBuffer: mockDownloadWorkspaceFile,
}))

vi.mock('@/lib/table/service', () => ({
  addTableColumn: vi.fn(),
  batchInsertRows: mockBatchInsertRows,
  batchUpdateRows: vi.fn(),
  createTable: vi.fn(),
  deleteColumn: vi.fn(),
  deleteColumns: vi.fn(),
  deleteRow: vi.fn(),
  deleteRowsByFilter: vi.fn(),
  deleteRowsByIds: vi.fn(),
  deleteTable: vi.fn(),
  getRowById: vi.fn(),
  getTableById: mockGetTableById,
  insertRow: vi.fn(),
  queryRows: vi.fn(),
  renameColumn: vi.fn(),
  renameTable: vi.fn(),
  replaceTableRows: mockReplaceTableRows,
  updateColumnConstraints: vi.fn(),
  updateColumnType: vi.fn(),
  updateRow: vi.fn(),
  updateRowsByFilter: vi.fn(),
}))

import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

describe('userTableServerTool.import_file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkspaceFileReference.mockResolvedValue({
      name: 'people.csv',
      type: 'text/csv',
    })
    mockDownloadWorkspaceFile.mockResolvedValue(Buffer.from('name,age\nAlice,30\nBob,40'))
    mockGetTableById.mockResolvedValue(buildTable())
    mockBatchInsertRows.mockImplementation(async (data: { rows: unknown[] }) =>
      data.rows.map((_, i) => ({ id: `row_${i}` }))
    )
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 0, insertedCount: 0 })
  })

  it('appends rows using auto-mapping by default', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'file-1' },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(result.data?.mode).toBe('append')
    expect(result.data?.rowCount).toBe(2)
    expect(mockBatchInsertRows).toHaveBeenCalledTimes(1)
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
    const call = mockBatchInsertRows.mock.calls[0][0] as { rows: unknown[] }
    expect(call.rows).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 40 },
    ])
  })

  it('replaces rows in replace mode', async () => {
    mockReplaceTableRows.mockResolvedValueOnce({ deletedCount: 3, insertedCount: 2 })
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'file-1', mode: 'replace' },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(result.data?.mode).toBe('replace')
    expect(result.data?.deletedCount).toBe(3)
    expect(result.data?.insertedCount).toBe(2)
    expect(mockReplaceTableRows).toHaveBeenCalledTimes(1)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('uses the caller-provided mapping', async () => {
    mockDownloadWorkspaceFile.mockResolvedValueOnce(
      Buffer.from('Full Name,Years\nAlice,30\nBob,40')
    )
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: {
          tableId: 'tbl_1',
          fileId: 'file-1',
          mapping: { 'Full Name': 'name', Years: 'age' },
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    const call = mockBatchInsertRows.mock.calls[0][0] as { rows: unknown[] }
    expect(call.rows).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 40 },
    ])
  })

  it('rejects unknown modes', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'file-1', mode: 'merge' },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Invalid mode/)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('refuses to import into an archived table', async () => {
    mockGetTableById.mockResolvedValueOnce(buildTable({ archivedAt: new Date('2024-02-01') }))
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'file-1' },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/archived/i)
  })

  it('refuses to import when the table belongs to a different workspace', async () => {
    mockGetTableById.mockResolvedValueOnce(buildTable({ workspaceId: 'workspace-other' }))
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'file-1' },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not found/i)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('reports missing required columns instead of inserting', async () => {
    mockDownloadWorkspaceFile.mockResolvedValueOnce(Buffer.from('age\n30'))
    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'file-1' },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/missing required columns/i)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })
})
