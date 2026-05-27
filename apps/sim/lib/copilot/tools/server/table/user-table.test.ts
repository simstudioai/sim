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
  mockAddWorkflowGroup,
  fakeEnrichment,
} = vi.hoisted(() => ({
  mockResolveWorkspaceFileReference: vi.fn(),
  mockDownloadWorkspaceFile: vi.fn(),
  mockGetTableById: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockReplaceTableRows: vi.fn(),
  mockAddWorkflowGroup: vi.fn(),
  fakeEnrichment: {
    id: 'work-email',
    name: 'Work Email',
    description: 'Find work email',
    icon: () => null,
    inputs: [
      { id: 'fullName', name: 'Full name', type: 'string', required: true },
      { id: 'companyDomain', name: 'Company domain', type: 'string', required: true },
    ],
    outputs: [{ id: 'email', name: 'email', type: 'string' }],
    providers: [],
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('deadbeefcafef00d'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
  fetchWorkspaceFileBuffer: mockDownloadWorkspaceFile,
}))

vi.mock('@/enrichments/registry', () => ({
  ALL_ENRICHMENTS: [fakeEnrichment],
  getEnrichment: (id: string) => (id === fakeEnrichment.id ? fakeEnrichment : undefined),
}))

vi.mock('@/lib/table/service', () => ({
  addTableColumn: vi.fn(),
  addWorkflowGroup: mockAddWorkflowGroup,
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

describe('userTableServerTool.list_enrichments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the enrichment catalog metadata', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'list_enrichments', args: {} },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(result.data?.enrichments).toEqual([
      {
        id: 'work-email',
        name: 'Work Email',
        description: 'Find work email',
        inputs: [
          { id: 'fullName', name: 'Full name', type: 'string', required: true },
          { id: 'companyDomain', name: 'Company domain', type: 'string', required: true },
        ],
        outputs: [{ id: 'email', name: 'email', type: 'string' }],
      },
    ])
  })
})

describe('userTableServerTool.add_enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(
      buildTable({
        schema: {
          columns: [
            { name: 'name', type: 'string' },
            { name: 'company', type: 'string' },
          ],
        },
      })
    )
    mockAddWorkflowGroup.mockResolvedValue(buildTable())
  })

  it('creates an enrichment group with mapped inputs and derived output columns', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'add_enrichment',
        args: {
          tableId: 'tbl_1',
          enrichmentId: 'work-email',
          inputMappings: [
            { inputName: 'fullName', columnName: 'name' },
            { inputName: 'companyDomain', columnName: 'company' },
          ],
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(result.data?.groupId).toBe('deadbeefcafef00d')
    expect(mockAddWorkflowGroup).toHaveBeenCalledTimes(1)
    const call = mockAddWorkflowGroup.mock.calls[0][0]
    expect(call.autoRun).toBe(false)
    expect(call.group).toMatchObject({
      type: 'enrichment',
      enrichmentId: 'work-email',
      workflowId: '',
      autoRun: false,
      dependencies: { columns: ['name', 'company'] },
      inputMappings: [
        { inputName: 'fullName', columnName: 'name' },
        { inputName: 'companyDomain', columnName: 'company' },
      ],
      outputs: [{ blockId: '', path: '', outputId: 'email', columnName: 'email' }],
    })
    expect(call.outputColumns).toEqual([
      {
        name: 'email',
        type: 'string',
        required: false,
        unique: false,
        workflowGroupId: 'deadbeefcafef00d',
      },
    ])
  })

  it('enables auto-run when explicitly requested', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'add_enrichment',
        args: {
          tableId: 'tbl_1',
          enrichmentId: 'work-email',
          inputMappings: [
            { inputName: 'fullName', columnName: 'name' },
            { inputName: 'companyDomain', columnName: 'company' },
          ],
          autoRun: true,
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/auto-run enabled/)
    const call = mockAddWorkflowGroup.mock.calls[0][0]
    expect(call.autoRun).toBe(true)
    expect(call.group.autoRun).toBe(true)
  })

  it('rejects an unknown enrichment id', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'add_enrichment',
        args: { tableId: 'tbl_1', enrichmentId: 'nope', inputMappings: [] },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Unknown enrichment/)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('rejects when a required input is unmapped', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'add_enrichment',
        args: {
          tableId: 'tbl_1',
          enrichmentId: 'work-email',
          inputMappings: [{ inputName: 'fullName', columnName: 'name' }],
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/requires input "companyDomain"/)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('rejects when a mapped column does not exist on the table', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'add_enrichment',
        args: {
          tableId: 'tbl_1',
          enrichmentId: 'work-email',
          inputMappings: [
            { inputName: 'fullName', columnName: 'name' },
            { inputName: 'companyDomain', columnName: 'missing_col' },
          ],
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/does not exist/)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })
})
