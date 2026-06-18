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
  mockCreateTable,
  mockDeleteTable,
  mockGetWorkspaceTableLimits,
  mockMarkTableJobRunning,
  mockReleaseJobClaim,
  mockQueryRows,
  mockDeleteRowsByFilter,
  mockUpdateRowsByFilter,
  mockRunTableImport,
  mockRunTableDelete,
  mockRunTableUpdate,
  fakeEnrichment,
} = vi.hoisted(() => ({
  mockResolveWorkspaceFileReference: vi.fn(),
  mockDownloadWorkspaceFile: vi.fn(),
  mockGetTableById: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockReplaceTableRows: vi.fn(),
  mockAddWorkflowGroup: vi.fn(),
  mockCreateTable: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockMarkTableJobRunning: vi.fn(),
  mockReleaseJobClaim: vi.fn(),
  mockQueryRows: vi.fn(),
  mockDeleteRowsByFilter: vi.fn(),
  mockUpdateRowsByFilter: vi.fn(),
  mockRunTableImport: vi.fn(),
  mockRunTableDelete: vi.fn(),
  mockRunTableUpdate: vi.fn(),
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
  createTable: mockCreateTable,
  deleteTable: mockDeleteTable,
  getTableById: mockGetTableById,
  renameTable: vi.fn(),
}))

vi.mock('@/lib/table/workflow-groups/service', () => ({
  addWorkflowGroup: mockAddWorkflowGroup,
  addWorkflowGroupOutput: vi.fn(),
  deleteWorkflowGroup: vi.fn(),
  deleteWorkflowGroupOutput: vi.fn(),
  updateWorkflowGroup: vi.fn(),
}))

vi.mock('@/lib/table/columns/service', () => ({
  addTableColumn: vi.fn(),
  deleteColumn: vi.fn(),
  deleteColumns: vi.fn(),
  renameColumn: vi.fn(),
  updateColumnConstraints: vi.fn(),
  updateColumnType: vi.fn(),
}))

vi.mock('@/lib/table/rows/service', () => ({
  batchInsertRows: mockBatchInsertRows,
  batchUpdateRows: vi.fn(),
  deleteRow: vi.fn(),
  deleteRowsByFilter: mockDeleteRowsByFilter,
  deleteRowsByIds: vi.fn(),
  getRowById: vi.fn(),
  insertRow: vi.fn(),
  queryRows: mockQueryRows,
  replaceTableRows: mockReplaceTableRows,
  updateRow: vi.fn(),
  updateRowsByFilter: mockUpdateRowsByFilter,
}))

vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunning: mockMarkTableJobRunning,
  releaseJobClaim: mockReleaseJobClaim,
}))

vi.mock('@/lib/table/import-runner', () => ({
  runTableImport: mockRunTableImport,
}))

vi.mock('@/lib/table/delete-runner', () => ({
  markTableDeleteFailed: vi.fn(),
  runTableDelete: mockRunTableDelete,
}))

vi.mock('@/lib/table/update-runner', () => ({
  markTableUpdateFailed: vi.fn(),
  runTableUpdate: mockRunTableUpdate,
}))

vi.mock('@/lib/table/billing', () => ({
  getWorkspaceTableLimits: mockGetWorkspaceTableLimits,
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

/** Lets a runDetached microtask chain run before asserting on the work it dispatched. */
async function flushDetached(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('userTableServerTool.import_file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkspaceFileReference.mockResolvedValue({
      name: 'people.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/people.csv',
      size: 100,
    })
    mockDownloadWorkspaceFile.mockResolvedValue(Buffer.from('name,age\nAlice,30\nBob,40'))
    mockGetTableById.mockResolvedValue(buildTable())
    mockMarkTableJobRunning.mockResolvedValue(true)
    mockReleaseJobClaim.mockResolvedValue(undefined)
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

  it('claims and releases the table job slot around an inline import', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('tbl_1', expect.any(String), 'import')
    expect(mockReleaseJobClaim).toHaveBeenCalledWith(
      'tbl_1',
      mockMarkTableJobRunning.mock.calls[0][1]
    )
  })

  it('rejects an inline import while another job holds the table slot', async () => {
    mockMarkTableJobRunning.mockResolvedValueOnce(false)
    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/job is already in progress/i)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
    expect(mockReleaseJobClaim).not.toHaveBeenCalled()
  })

  it('dispatches a background import for large CSV files', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce({
      name: 'big.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/big.csv',
      size: 9 * 1024 * 1024,
    })

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1', mode: 'replace' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.jobId).toBeDefined()
    expect(result.message).toMatch(/background/i)
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('tbl_1', expect.any(String), 'import')
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
    expect(mockDownloadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockRunTableImport).toHaveBeenCalledTimes(1)
    expect(mockRunTableImport.mock.calls[0][0]).toMatchObject({
      tableId: 'tbl_1',
      workspaceId: 'workspace-1',
      fileKey: 'workspace/workspace-1/big.csv',
      mode: 'replace',
      deleteSourceFile: false,
    })
  })

  it('rejects a background import while another job holds the table slot', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce({
      name: 'big.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/big.csv',
      size: 9 * 1024 * 1024,
    })
    mockMarkTableJobRunning.mockResolvedValueOnce(false)

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/job is already in progress/i)
    expect(mockRunTableImport).not.toHaveBeenCalled()
  })
})

describe('userTableServerTool.create_from_file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkspaceFileReference.mockResolvedValue({
      name: 'people.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/people.csv',
      size: 100,
    })
    mockDownloadWorkspaceFile.mockResolvedValue(Buffer.from('name,age\nAlice,30\nBob,40'))
    mockGetWorkspaceTableLimits.mockResolvedValue({ maxRowsPerTable: 1000, maxTables: 3 })
    mockCreateTable.mockResolvedValue(buildTable({ id: 'tbl_new', name: 'people' }))
    mockDeleteTable.mockResolvedValue(undefined)
    mockBatchInsertRows.mockImplementation(async (data: { rows: unknown[] }) =>
      data.rows.map((_, i) => ({ id: `row_${i}` }))
    )
  })

  it('stamps the workspace plan limits on the created table', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(mockGetWorkspaceTableLimits).toHaveBeenCalledWith('workspace-1')
    expect(mockCreateTable).toHaveBeenCalledTimes(1)
    const createArgs = mockCreateTable.mock.calls[0][0] as { maxTables: number }
    expect(createArgs.maxTables).toBe(3)
  })

  it('truncates to the plan row limit and reports dropped rows', async () => {
    // File has 2 data rows (Alice, Bob); plan cap is 1.
    mockGetWorkspaceTableLimits.mockResolvedValueOnce({ maxRowsPerTable: 1, maxTables: 3 })

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(mockCreateTable).toHaveBeenCalledTimes(1)
    const insertCall = mockBatchInsertRows.mock.calls[0][0] as { rows: unknown[] }
    expect(insertCall.rows).toHaveLength(1)
    expect(result.data?.rowCount).toBe(1)
    expect(result.message).toMatch(/dropped 1 row/i)
    expect(mockDeleteTable).not.toHaveBeenCalled()
  })

  it('rolls back the created table and reports the reason when row insertion fails', async () => {
    mockBatchInsertRows.mockRejectedValueOnce(new Error('Row 2: Column "email" must be unique'))

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(mockDeleteTable).toHaveBeenCalledWith('tbl_new', expect.any(String))
    expect(result.message).toMatch(/rolled back/i)
    expect(result.message).toMatch(/must be unique/i)
  })

  it('creates a placeholder table and dispatches a background import for large CSV files', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce({
      name: 'big.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/big.csv',
      size: 9 * 1024 * 1024,
    })

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.tableId).toBe('tbl_new')
    expect(result.data?.jobId).toBeDefined()
    expect(mockDownloadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
    const createArgs = mockCreateTable.mock.calls[0][0] as Record<string, unknown>
    expect(createArgs).toMatchObject({
      jobStatus: 'running',
      jobType: 'import',
      jobId: result.data?.jobId,
    })
    expect(mockRunTableImport).toHaveBeenCalledTimes(1)
    expect(mockRunTableImport.mock.calls[0][0]).toMatchObject({
      tableId: 'tbl_new',
      mode: 'create',
      fileKey: 'workspace/workspace-1/big.csv',
      deleteSourceFile: false,
    })
  })
})

describe('userTableServerTool.create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceTableLimits.mockResolvedValue({ maxRowsPerTable: 1000, maxTables: 3 })
    mockCreateTable.mockResolvedValue(buildTable({ id: 'tbl_new', name: 'People' }))
  })

  it('stamps the workspace plan limits on the created table', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'create',
        args: {
          name: 'People',
          schema: { columns: [{ name: 'name', type: 'string', required: true }] },
        },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(mockGetWorkspaceTableLimits).toHaveBeenCalledWith('workspace-1')
    const createArgs = mockCreateTable.mock.calls[0][0] as { maxTables: number }
    expect(createArgs.maxTables).toBe(3)
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

describe('userTableServerTool.query_rows', () => {
  const queryRow = (i: number) => ({
    id: `row_${i}`,
    data: { name: `r${i}` },
    executions: {},
    position: i,
    orderKey: `a${i}`,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockQueryRows.mockResolvedValue({
      rows: [queryRow(1), queryRow(2)],
      rowCount: 2,
      totalCount: 10,
      limit: 2,
      offset: 0,
    })
  })

  it('clamps an over-large query limit to MAX_QUERY_LIMIT instead of rejecting', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1', limit: 100000 } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    const options = mockQueryRows.mock.calls[0][1] as Record<string, unknown>
    expect(options.limit).toBe(1000)
  })

  it('queries without execution metadata and passes limit/offset through', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1', limit: 2, offset: 10 } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    const options = mockQueryRows.mock.calls[0][1] as Record<string, unknown>
    expect(options.withExecutions).toBe(false)
    expect(options.offset).toBe(10)
    expect(result.data?.nextCursor).toBeUndefined()
  })
})

describe('userTableServerTool.delete_rows_by_filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable({ rowCount: 50000, maxRows: 100000 }))
    mockMarkTableJobRunning.mockResolvedValue(true)
    mockDeleteRowsByFilter.mockResolvedValue({ affectedCount: 5, affectedRowIds: ['r1'] })
    mockQueryRows.mockResolvedValue({
      rows: [],
      rowCount: 0,
      totalCount: 5,
      limit: 1,
      offset: 0,
    })
  })

  it('escalates an explicit limit above the cap to a background delete with maxRows (unmasked)', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: 20000,
      limit: 1,
      offset: 0,
    })

    const result = await userTableServerTool.execute(
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, limit: 5000 },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(true)
    // target = min(limit 5000, matchCount 20000) = 5000, above the inline cap → background.
    expect(result.data?.doomedCount).toBe(5000)
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
    const [, , type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(type).toBe('delete')
    // Bounded delete carries maxRows and omits doomedCount so the mask is skipped and the count
    // isn't double-subtracted.
    expect(payload).toMatchObject({ maxRows: 5000 })
    expect((payload as { doomedCount?: number }).doomedCount).toBeUndefined()
    expect(mockRunTableDelete.mock.calls[0][0]).toMatchObject({ maxRows: 5000 })
  })

  it('deletes inline when the unbounded match count is within the cap', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'delete_rows_by_filter', args: { tableId: 'tbl_1', filter: { name: 'x' } } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(result.data?.affectedCount).toBe(5)
    expect(mockDeleteRowsByFilter).toHaveBeenCalledTimes(1)
    // Inline delete still claims (and releases) the table's write-job slot.
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('tbl_1', expect.any(String), 'delete')
    expect(mockReleaseJobClaim).toHaveBeenCalled()
  })

  it('rejects an inline delete while another job holds the table slot', async () => {
    mockMarkTableJobRunning.mockResolvedValueOnce(false)

    const result = await userTableServerTool.execute(
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, limit: 100 },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/job is already in progress/i)
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
  })

  it('dispatches a background delete when the unbounded match count exceeds the cap', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: 20000,
      limit: 1,
      offset: 0,
    })

    const result = await userTableServerTool.execute(
      { operation: 'delete_rows_by_filter', args: { tableId: 'tbl_1', filter: { name: 'x' } } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.jobId).toBeDefined()
    expect(result.data?.doomedCount).toBe(20000)
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
    const [tableId, jobId, type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(tableId).toBe('tbl_1')
    expect(type).toBe('delete')
    expect(payload).toMatchObject({ doomedCount: 20000, cutoff: expect.any(String) })
    // Unbounded delete masks the whole set — no maxRows cap.
    expect((payload as { maxRows?: number }).maxRows).toBeUndefined()
    expect(mockRunTableDelete).toHaveBeenCalledTimes(1)
    expect(mockRunTableDelete.mock.calls[0][0]).toMatchObject({
      jobId,
      tableId: 'tbl_1',
      workspaceId: 'workspace-1',
      cutoff: expect.any(Date),
    })
  })

  it('rejects a background delete while another job holds the table slot', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: 20000,
      limit: 1,
      offset: 0,
    })
    mockMarkTableJobRunning.mockResolvedValueOnce(false)

    const result = await userTableServerTool.execute(
      { operation: 'delete_rows_by_filter', args: { tableId: 'tbl_1', filter: { name: 'x' } } },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/job is already in progress/i)
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  it('deletes inline with an explicit limit without counting first', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, limit: 100 },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(true)
    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockDeleteRowsByFilter).toHaveBeenCalledTimes(1)
  })
})

describe('userTableServerTool.update_rows_by_filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockMarkTableJobRunning.mockResolvedValue(true)
    mockUpdateRowsByFilter.mockResolvedValue({ affectedCount: 5, affectedRowIds: ['r1'] })
    mockQueryRows.mockResolvedValue({ rows: [], rowCount: 0, totalCount: 5, limit: 1, offset: 0 })
  })

  it('escalates an explicit limit above the cap to a background update with maxRows', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: 20000,
      limit: 1,
      offset: 0,
    })
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, data: { age: 1 }, limit: 5000 },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(true)
    // target = min(limit 5000, matchCount 20000) = 5000, above the inline cap → background.
    expect(result.data?.affectedCount).toBe(5000)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
    const [, , type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(type).toBe('update')
    expect(payload).toMatchObject({ affectedCount: 5000, maxRows: 5000 })
    expect(mockRunTableUpdate.mock.calls[0][0]).toMatchObject({ maxRows: 5000 })
  })

  it('updates inline when the unbounded match count is within the cap', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, data: { age: 1 } },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(true)
    expect(result.data?.affectedCount).toBe(5)
    expect(mockUpdateRowsByFilter).toHaveBeenCalledTimes(1)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('dispatches a background update when the unbounded match count exceeds the cap', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: 20000,
      limit: 1,
      offset: 0,
    })
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, data: { age: 1 } },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.jobId).toBeDefined()
    expect(result.data?.affectedCount).toBe(20000)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
    const [tableId, jobId, type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(tableId).toBe('tbl_1')
    expect(type).toBe('update')
    expect(payload).toMatchObject({
      affectedCount: 20000,
      cutoff: expect.any(String),
      data: { age: 1 },
    })
    // Unbounded match (no explicit limit) → the worker patches every match, no cap.
    expect((payload as { maxRows?: number }).maxRows).toBeUndefined()
    expect(mockRunTableUpdate).toHaveBeenCalledTimes(1)
    expect(mockRunTableUpdate.mock.calls[0][0]).toMatchObject({
      jobId,
      tableId: 'tbl_1',
      workspaceId: 'workspace-1',
      cutoff: expect.any(Date),
    })
  })

  it('keeps a unique-column patch inline even when many rows match', async () => {
    mockGetTableById.mockResolvedValue(
      buildTable({ schema: { columns: [{ name: 'email', type: 'string', unique: true }] } })
    )
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { email: 'x' }, data: { email: 'y' } },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(true)
    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
    expect(mockUpdateRowsByFilter).toHaveBeenCalledTimes(1)
  })

  it('rejects a background update while another job holds the table slot', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: 20000,
      limit: 1,
      offset: 0,
    })
    mockMarkTableJobRunning.mockResolvedValueOnce(false)
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, data: { age: 1 } },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/job is already in progress/i)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
    expect(mockRunTableUpdate).not.toHaveBeenCalled()
  })

  it('updates inline with an explicit limit without counting first', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { name: 'x' }, data: { age: 1 }, limit: 100 },
      },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(result.success).toBe(true)
    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockUpdateRowsByFilter).toHaveBeenCalledTimes(1)
  })
})
