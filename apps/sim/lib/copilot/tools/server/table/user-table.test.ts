/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { TableDefinition } from '@/lib/table'

const {
  mockUpdateColumnType,
  mockUpdateColumnOptions,
  mockResolveWorkspaceFileReference,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockDownloadWorkspaceFile,
  mockGetTableById,
  mockBatchInsertRows,
  mockInsertRow,
  mockUpdateRow,
  mockReplaceTableRows,
  mockAddWorkflowGroup,
  mockCreateTable,
  mockDeleteTable,
  mockGetWorkspaceTableLimits,
  mockMarkTableJobRunning,
  mockReleaseJobClaim,
  mockQueryRows,
  mockDeleteRowsByFilter,
  mockDeleteColumns,
  mockUpdateRowsByFilter,
  mockRunTableImport,
  mockRunTableDelete,
  mockRunTableUpdate,
  mockExecuteCopilotFileUseCase,
  mockExecuteCopilotWorkflowUseCase,
  mockLoadWorkspaceFileContext,
  mockLoadTableRowSecretProvenance,
  mockResolveWorkflowContext,
  fakeEnrichment,
} = vi.hoisted(() => ({
  mockUpdateColumnType: vi.fn(),
  mockUpdateColumnOptions: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockDownloadWorkspaceFile: vi.fn(),
  mockGetTableById: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockInsertRow: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockReplaceTableRows: vi.fn(),
  mockAddWorkflowGroup: vi.fn(),
  mockCreateTable: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockMarkTableJobRunning: vi.fn(),
  mockReleaseJobClaim: vi.fn(),
  mockQueryRows: vi.fn(),
  mockDeleteRowsByFilter: vi.fn(),
  mockDeleteColumns: vi.fn(),
  mockUpdateRowsByFilter: vi.fn(),
  mockRunTableImport: vi.fn(),
  mockRunTableDelete: vi.fn(),
  mockRunTableUpdate: vi.fn(),
  mockExecuteCopilotFileUseCase: vi.fn(),
  mockExecuteCopilotWorkflowUseCase: vi.fn(),
  mockLoadWorkspaceFileContext: vi.fn(),
  mockLoadTableRowSecretProvenance: vi.fn(),
  mockResolveWorkflowContext: vi.fn(),
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
  resolveWorkspaceFileReference: async (workspaceId: string, reference: string) => {
    const file = await mockResolveWorkspaceFileReference(workspaceId, reference)
    return file ? { ...file, workspaceId: file.workspaceId ?? workspaceId } : null
  },
  fetchWorkspaceFileBuffer: mockDownloadWorkspaceFile,
  loadActiveWorkspaceFileContext: mockLoadWorkspaceFileContext,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: {
    execute: async () => ({ content: await mockDownloadWorkspaceFile() }),
  },
}))
vi.mock('@/lib/copilot/auth/file-delegation', () => ({
  resolveCopilotFilePrincipal: vi.fn(() => ({
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'test-tool',
    audience: 'sim:workspace-files',
    issuedAt: new Date(0),
    expiresAt: new Date(Date.now() + 60_000),
  })),
}))

vi.mock('@/lib/copilot/auth/table-delegation', () => ({
  messageForCopilotTableError: (error: unknown) => {
    const classified = error as { code?: string; message?: string }
    return classified.code && classified.code !== 'internal'
      ? (classified.message ?? 'Table operation failed')
      : 'Table operation failed'
  },
}))

vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: mockExecuteCopilotFileUseCase,
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotResolveWorkflowOutputs: mockExecuteCopilotWorkflowUseCase,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: vi.fn().mockResolvedValue('write'),
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: async (input: { tableId: string; assertedWorkspaceId?: string }) => {
    const table = await mockGetTableById(input.tableId)
    if (!table || (input.assertedWorkspaceId && table.workspaceId !== input.assertedWorkspaceId)) {
      throw Object.assign(new Error('Table not found'), { code: 'not_found' })
    }
    if (table.archivedAt) {
      throw Object.assign(new Error('Table is archived'), { code: 'conflict' })
    }
    return {
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    }
  },
  resolveTableWorkspaceContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'user-1',
  }),
}))

vi.mock('@/lib/table/application/folder-paths', () => ({
  resolveTableFolderPath: async () => ({
    folderId: null,
    index: { idByPath: new Map(), pathById: new Map() },
  }),
  tableFolderPathForId: () => '/',
  archivableTableFolderPath: () => '/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mockGetBoundWorkspaceFileSecretProvenance,
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
  deleteColumns: mockDeleteColumns,
  renameColumn: vi.fn(),
  updateColumnConstraints: vi.fn(),
  updateColumnType: mockUpdateColumnType,
  updateColumnOptions: mockUpdateColumnOptions,
}))

vi.mock('@/lib/table/rows/service', () => ({
  batchInsertRows: mockBatchInsertRows,
  batchUpdateRows: vi.fn(),
  deleteRow: vi.fn(),
  deleteRowsByFilter: mockDeleteRowsByFilter,
  deleteRowsByIds: vi.fn(),
  getRowById: vi.fn(),
  insertRow: mockInsertRow,
  queryRows: mockQueryRows,
  replaceTableRows: mockReplaceTableRows,
  updateRow: mockUpdateRow,
  updateRowsByFilter: mockUpdateRowsByFilter,
}))

vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: (data: Record<string, unknown>) => ({
    complete: true,
    columns: Object.fromEntries(
      Object.keys(data).map((columnId) => [columnId, { version: 1, complete: true, entries: [] }])
    ),
  }),
  loadTableRowSecretProvenance: mockLoadTableRowSecretProvenance,
}))

vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunningInWorkspace: mockMarkTableJobRunning,
  releaseJobClaimInWorkspace: mockReleaseJobClaim,
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

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mockResolveWorkflowContext,
}))

vi.mock('@/lib/workflows/application/resolve-workflow-outputs', () => ({
  loadResolvedWorkflowOutputs: async () => mockExecuteCopilotWorkflowUseCase(),
  resolveWorkflowOutputs: { operation: { id: 'workflows.read' } },
}))

import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'
import { encodeCursor } from '@/lib/table/rows/cursor'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

beforeEach(() => {
  mockLoadWorkspaceFileContext.mockResolvedValue({ workspaceId: 'workspace-1' })
  mockLoadTableRowSecretProvenance.mockResolvedValue({
    version: 1,
    complete: true,
    entries: [],
    scope: { userId: 'user-1', workspaceId: 'workspace-1' },
  })
  mockResolveWorkflowContext.mockImplementation(
    async ({
      workflowId,
      assertedWorkspaceId,
    }: {
      workflowId: string
      assertedWorkspaceId: string
    }) => ({
      workflowId,
      workspaceId: assertedWorkspaceId,
    })
  )
  mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
    workflowId: 'workflow-1',
    outputs: [
      {
        blockId: 'block-1',
        blockName: 'Agent',
        blockType: 'agent',
        path: 'content',
        leafType: 'string',
      },
    ],
    executionOrderByBlockId: { 'block-1': 1 },
  })
  mockExecuteCopilotFileUseCase.mockImplementation(
    async (_context: unknown, _useCase: unknown, input: Record<string, unknown>) => {
      const workspaceId = String(input.workspaceId)
      const reference = String(input.reference)
      const file = await mockResolveWorkspaceFileReference(workspaceId, reference)
      if (!file) throw new OrchestrationError('not_found', 'File not found')
      const provenance = await mockGetBoundWorkspaceFileSecretProvenance(workspaceId, {
        fileId: file.id,
        key: file.key,
        context: 'workspace',
      })
      if (provenance.status !== 'exact' || provenance.entries.length > 0) {
        throw new OrchestrationError(
          'validation',
          `Cannot import "${reference}": the file cannot be verified as free of resolved secrets.`
        )
      }
      return {
        file: { ...file, workspaceId },
        ...(input.maxBytes === undefined
          ? {}
          : { content: await mockDownloadWorkspaceFile(file, { maxBytes: input.maxBytes }) }),
      }
    }
  )
})

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

function buildToolContext() {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-call-1',
    copilotToolExecution: true,
  } as const
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
      id: 'file-1',
      name: 'people.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/people.csv',
      size: 100,
    })
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mockDownloadWorkspaceFile.mockResolvedValue(Buffer.from('name,age\nAlice,30\nBob,40'))
    mockGetTableById.mockResolvedValue(buildTable())
    mockMarkTableJobRunning.mockResolvedValue(true)
    mockReleaseJobClaim.mockResolvedValue(true)
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
      buildToolContext()
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
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(result.data?.mode).toBe('replace')
    expect(result.data?.deletedCount).toBe(3)
    expect(result.data?.insertedCount).toBe(2)
    expect(mockReplaceTableRows).toHaveBeenCalledTimes(1)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
    const call = mockReplaceTableRows.mock.calls[0][0] as {
      secretProvenance: Array<{ complete: boolean; columns: Record<string, unknown> }>
    }
    expect(call.secretProvenance).toEqual([
      {
        complete: true,
        columns: {
          name: { version: 1, complete: true, entries: [] },
          age: { version: 1, complete: true, entries: [] },
        },
      },
      {
        complete: true,
        columns: {
          name: { version: 1, complete: true, entries: [] },
          age: { version: 1, complete: true, entries: [] },
        },
      },
    ])
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
      buildToolContext()
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
      buildToolContext()
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
      buildToolContext()
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
      buildToolContext()
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
      buildToolContext()
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/missing required columns/i)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('claims and releases the table job slot around an inline import', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith(
      'tbl_1',
      'workspace-1',
      expect.any(String),
      'import'
    )
    expect(mockReleaseJobClaim).toHaveBeenCalledWith(
      'tbl_1',
      'workspace-1',
      mockMarkTableJobRunning.mock.calls[0][2]
    )
  })

  it('rejects an inline import while another job holds the table slot', async () => {
    mockMarkTableJobRunning.mockResolvedValueOnce(false)
    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/job is already in progress/i)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
    expect(mockReleaseJobClaim).not.toHaveBeenCalled()
  })

  it('dispatches a background import for large CSV files', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce({
      id: 'file-1',
      name: 'big.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/big.csv',
      size: 9 * 1024 * 1024,
    })

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1', mode: 'replace' } },
      buildToolContext()
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.jobId).toBeDefined()
    expect(result.message).toMatch(/background/i)
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith(
      'tbl_1',
      'workspace-1',
      expect.any(String),
      'import'
    )
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

  it('rejects a workspace file with resolved-secret provenance before importing rows', async () => {
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValueOnce({
      status: 'exact',
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted' }],
    })

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/cannot be verified as free of resolved secrets/i)
    expect(mockDownloadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('points a chat-upload path at save_upload instead of globbing files/', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce(null)

    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'uploads/people.csv' },
      },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/save_upload/)
    expect(result.message).not.toMatch(/glob\("files/)
  })

  it('still tells the agent to glob files\\/ for a genuine workspace-file miss', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce(null)

    const result = await userTableServerTool.execute(
      {
        operation: 'import_file',
        args: { tableId: 'tbl_1', fileId: 'files/typo.csv' },
      },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/File not found: "files\/typo\.csv"/)
  })

  /**
   * A malformed CSV silently loses records; the tool used to report the survivors
   * as a clean import, so the model had no signal that the file did not land whole.
   */
  it('surfaces rejected records in the message and payload of an append import', async () => {
    mockDownloadWorkspaceFile.mockResolvedValueOnce(
      Buffer.from('name,age\nAlice,30\nBroken,"unterminated\nBob,40\n')
    )

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/dropped at least 1 unreadable row/i)
    expect(result.message).toMatch(/CSV_QUOTE_NOT_CLOSED/)
    expect(result.data?.rejections).toMatchObject({ rowsRejected: 1 })
    expect(result.data?.rejections.rejectedSamples[0]).toMatchObject({
      code: 'CSV_QUOTE_NOT_CLOSED',
    })
  })

  it('surfaces rejected records in the message and payload of a replace import', async () => {
    mockDownloadWorkspaceFile.mockResolvedValueOnce(
      Buffer.from('name,age\nAlice,30\nBroken,"unterminated\nBob,40\n')
    )
    mockReplaceTableRows.mockResolvedValueOnce({ deletedCount: 3, insertedCount: 1 })

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1', mode: 'replace' } },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/dropped at least 1 unreadable row/i)
    expect(result.data?.rejections).toMatchObject({ rowsRejected: 1 })
  })

  it("leaves a clean import's message and payload untouched", async () => {
    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.message).toBe(
      'Imported 2 rows into "People" from "people.csv" (2 columns matched)'
    )
    expect(result.data).not.toHaveProperty('rejections')
  })

  it('rejects a background import while another job holds the table slot', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce({
      id: 'file-1',
      name: 'big.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/big.csv',
      size: 9 * 1024 * 1024,
    })
    mockMarkTableJobRunning.mockResolvedValueOnce(false)

    const result = await userTableServerTool.execute(
      { operation: 'import_file', args: { tableId: 'tbl_1', fileId: 'file-1' } },
      buildToolContext()
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
      id: 'file-1',
      name: 'people.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/people.csv',
      size: 100,
    })
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
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
      buildToolContext()
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
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(mockCreateTable).toHaveBeenCalledTimes(1)
    const insertCall = mockBatchInsertRows.mock.calls[0][0] as { rows: unknown[] }
    expect(insertCall.rows).toHaveLength(1)
    expect(result.data?.rowCount).toBe(1)
    expect(result.message).toMatch(/dropped 1 row/i)
    expect(mockDeleteTable).not.toHaveBeenCalled()
  })

  it('rolls back the created table and safely conceals unknown insertion failures', async () => {
    mockBatchInsertRows.mockRejectedValueOnce(new Error('Row 2: Column "email" must be unique'))

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(mockDeleteTable).toHaveBeenCalledWith('tbl_new', expect.any(String))
    expect(result.message).toBe('Operation failed: Table operation failed')
    expect(result.message).not.toMatch(/must be unique/i)
  })

  it('creates a placeholder table and dispatches a background import for large CSV files', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValueOnce({
      id: 'file-1',
      name: 'big.csv',
      type: 'text/csv',
      key: 'workspace/workspace-1/big.csv',
      size: 9 * 1024 * 1024,
    })

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      buildToolContext()
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

  it('surfaces rejected records alongside the created table', async () => {
    mockDownloadWorkspaceFile.mockResolvedValueOnce(
      Buffer.from('name,age\nAlice,30\nBroken,"unterminated\nBob,40\n')
    )

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/dropped at least 1 unreadable row/i)
    expect(result.message).toMatch(/CSV_QUOTE_NOT_CLOSED/)
    expect(result.data?.rejections).toMatchObject({ rowsRejected: 1 })
  })

  it('leaves a clean create_from_file message and payload untouched', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.message).toBe(
      'Created table "people" with 2 columns and 2 rows from "people.csv"'
    )
    expect(result.data).not.toHaveProperty('rejections')
  })

  it('rejects unknown workspace-file provenance before creating a table', async () => {
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValueOnce({ status: 'unknown' })

    const result = await userTableServerTool.execute(
      { operation: 'create_from_file', args: { fileId: 'file-1' } },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/cannot be verified as free of resolved secrets/i)
    expect(mockDownloadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockCreateTable).not.toHaveBeenCalled()
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
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(mockGetWorkspaceTableLimits).toHaveBeenCalledWith('workspace-1')
    const createArgs = mockCreateTable.mock.calls[0][0] as { maxTables: number }
    expect(createArgs.maxTables).toBe(3)
  })
})

describe('userTableServerTool.delete_column', () => {
  it('presents the authoritative canonical deletion for aliases and duplicates', async () => {
    const current = buildTable({
      schema: {
        columns: [
          { id: 'column-name', name: 'name', type: 'string' },
          { id: 'column-age', name: 'age', type: 'number' },
        ],
      },
    })
    mockGetTableById.mockResolvedValue(current)
    mockDeleteColumns.mockResolvedValue({
      ...current,
      schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' }] },
    })

    const result = await userTableServerTool.execute(
      {
        operation: 'delete_column',
        args: {
          tableId: 'tbl_1',
          columnNames: ['age', 'column-age', 'AGE'],
        },
      },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(result.message).toBe('Deleted 1 column: age')
    expect(mockDeleteColumns).toHaveBeenCalledWith(
      { tableId: 'tbl_1', columnNames: ['age', 'column-age', 'AGE'] },
      expect.any(String),
      { expectedWorkspaceId: 'workspace-1' }
    )
  })
})

describe('userTableServerTool workflow scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(buildTable())
    mockAddWorkflowGroup.mockImplementation(
      async ({ group, outputColumns }: { group: unknown; outputColumns: unknown[] }) =>
        buildTable({
          schema: {
            columns: outputColumns,
            workflowGroups: [group],
          } as never,
        })
    )
  })

  it('conceals a cross-workspace workflow id before persisting a group', async () => {
    mockResolveWorkflowContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    const result = await userTableServerTool.execute(
      {
        operation: 'add_workflow_group',
        args: {
          tableId: 'tbl_1',
          workflowId: 'workflow-cross-workspace',
          outputs: [{ blockId: 'block-1', path: 'content' }],
        },
      },
      buildToolContext()
    )

    expect(result).toEqual({ success: false, message: 'Operation failed: Workflow not found' })
    expect(mockResolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: 'workflow-cross-workspace',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('conceals unknown application failures from tool output', async () => {
    mockQueryRows.mockRejectedValueOnce(new Error('database host unavailable'))

    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1' } },
      buildToolContext()
    )

    expect(result).toEqual({ success: false, message: 'Operation failed: Table operation failed' })
    expect(result.message).not.toContain('database host unavailable')
  })
})

describe('userTableServerTool.list_enrichments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the enrichment catalog metadata', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'list_enrichments', args: {} },
      buildToolContext()
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
    mockAddWorkflowGroup.mockImplementation(
      async ({ group, outputColumns }: { group: unknown; outputColumns: unknown[] }) =>
        buildTable({
          schema: {
            columns: outputColumns,
            workflowGroups: [group],
          } as never,
        })
    )
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
      buildToolContext()
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
      buildToolContext()
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
      buildToolContext()
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
      buildToolContext()
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
      buildToolContext()
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

  it('rejects an explicit limit above the Copilot page cap before any DB call', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1', limit: 100000 } },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toBe('Limit cannot exceed 1000')
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('defaults an omitted Copilot page limit to the surface maximum', async () => {
    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1' } },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    const options = mockQueryRows.mock.calls[0][1] as Record<string, unknown>
    expect(options.limit).toBe(1000)
  })

  it('imports application-owned persisted provenance into the tool trace registry', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const importProvenance = vi.spyOn(registry, 'importCrossingProvenance')

    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1', limit: 2 } },
      { ...buildToolContext(), resolvedSecretTraceRegistry: registry }
    )

    expect(result.success).toBe(true)
    expect(mockLoadTableRowSecretProvenance).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'row_1' })]),
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(importProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        complete: true,
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      }),
      expect.arrayContaining([{ name: 'r1' }]),
      { trusted: true }
    )
  })

  it('normalizes a root condition before querying', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'query_rows',
        args: { tableId: 'tbl_1', filter: { field: 'name', op: 'eq', value: 'r1' } },
      },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(mockQueryRows.mock.calls[0][1].predicate).toEqual({
      all: [{ field: 'name', op: 'eq', value: 'r1' }],
    })
  })

  it('decodes an opaque cursor into after/offset and skips the count', async () => {
    const cursor = encodeCursor({
      lastRow: { id: 'row_9', orderKey: 'a9' },
      keysetValid: true,
      nextOffset: 20,
    })
    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1', limit: 2, cursor } },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    const options = mockQueryRows.mock.calls[0][1] as Record<string, unknown>
    expect(options.withExecutions).toBe(false)
    expect(options.after).toEqual({ orderKey: 'a9', id: 'row_9' })
    // A cursor page never re-counts.
    expect(options.includeTotal).toBe(false)
  })

  it('surfaces the opaque nextCursor (not an offset) in the "more available" message', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [queryRow(1), queryRow(2)],
      rowCount: 2,
      totalCount: 10,
      limit: 2,
      offset: 0,
      nextCursor: 'CURSOR_TOKEN_ABC',
    })
    const result = await userTableServerTool.execute(
      { operation: 'query_rows', args: { tableId: 'tbl_1', limit: 2 } },
      buildToolContext()
    )

    expect(result.message).toContain('more available')
    expect(result.message).toContain('cursor=CURSOR_TOKEN_ABC')
    expect(result.message).not.toContain('offset=')
  })

  it('rejects a keyset cursor combined with a custom sort', async () => {
    const cursor = encodeCursor({
      lastRow: { id: 'row_9', orderKey: 'a9' },
      keysetValid: true,
      nextOffset: 20,
    })
    const result = await userTableServerTool.execute(
      {
        operation: 'query_rows',
        args: { tableId: 'tbl_1', cursor, order: [{ field: 'name', direction: 'desc' }] },
      },
      buildToolContext()
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not valid for a sorted query/i)
    expect(mockQueryRows).not.toHaveBeenCalled()
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          limit: 5000,
        },
      },
      buildToolContext()
    )
    await flushDetached()

    expect(result.success).toBe(true)
    // target = min(limit 5000, matchCount 20000) = 5000, above the inline cap → background.
    expect(result.data?.doomedCount).toBe(5000)
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
    const [, , , type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(type).toBe('delete')
    // Bounded delete carries maxRows and omits doomedCount so the mask is skipped and the count
    // isn't double-subtracted.
    expect(payload).toMatchObject({ maxRows: 5000 })
    expect((payload as { doomedCount?: number }).doomedCount).toBeUndefined()
    expect(mockRunTableDelete.mock.calls[0][0]).toMatchObject({ maxRows: 5000 })
  })

  it('deletes inline when the unbounded match count is within the cap', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] } },
      },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(result.data?.affectedCount).toBe(5)
    expect(mockDeleteRowsByFilter).toHaveBeenCalledTimes(1)
    // Inline delete still claims (and releases) the table's write-job slot.
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith(
      'tbl_1',
      'workspace-1',
      expect.any(String),
      'delete'
    )
    expect(mockReleaseJobClaim).toHaveBeenCalled()
  })

  it('normalizes a root condition before deleting', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { field: 'name', op: 'eq', value: 'x' } },
      },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(mockDeleteRowsByFilter.mock.calls[0][1].filter).toEqual({ $and: [{ name: 'x' }] })
  })

  it('rejects an inline delete while another job holds the table slot', async () => {
    mockMarkTableJobRunning.mockResolvedValueOnce(false)

    const result = await userTableServerTool.execute(
      {
        operation: 'delete_rows_by_filter',
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          limit: 100,
        },
      },
      buildToolContext()
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
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] } },
      },
      buildToolContext()
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.jobId).toBeDefined()
    expect(result.data?.doomedCount).toBe(20000)
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
    const [tableId, workspaceId, jobId, type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(tableId).toBe('tbl_1')
    expect(workspaceId).toBe('workspace-1')
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
      {
        operation: 'delete_rows_by_filter',
        args: { tableId: 'tbl_1', filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] } },
      },
      buildToolContext()
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          limit: 100,
        },
      },
      buildToolContext()
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          data: { age: 1 },
          limit: 5000,
        },
      },
      buildToolContext()
    )
    await flushDetached()

    expect(result.success).toBe(true)
    // target = min(limit 5000, matchCount 20000) = 5000, above the inline cap → background.
    expect(result.data?.affectedCount).toBe(5000)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
    const [, , , type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(type).toBe('update')
    expect(payload).toMatchObject({ affectedCount: 5000, maxRows: 5000 })
    expect(mockRunTableUpdate.mock.calls[0][0]).toMatchObject({ maxRows: 5000 })
  })

  it('updates inline when the unbounded match count is within the cap', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          data: { age: 1 },
        },
      },
      buildToolContext()
    )
    expect(result.success).toBe(true)
    expect(result.data?.affectedCount).toBe(5)
    expect(mockUpdateRowsByFilter).toHaveBeenCalledTimes(1)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('normalizes a root condition before updating', async () => {
    const result = await userTableServerTool.execute(
      {
        operation: 'update_rows_by_filter',
        args: {
          tableId: 'tbl_1',
          filter: { field: 'name', op: 'eq', value: 'x' },
          data: { age: 1 },
        },
      },
      buildToolContext()
    )

    expect(result.success).toBe(true)
    expect(mockUpdateRowsByFilter.mock.calls[0][1].filter).toEqual({ $and: [{ name: 'x' }] })
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          data: { age: 1 },
        },
      },
      buildToolContext()
    )
    await flushDetached()

    expect(result.success).toBe(true)
    expect(result.data?.jobId).toBeDefined()
    expect(result.data?.affectedCount).toBe(20000)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
    const [tableId, workspaceId, jobId, type, payload] = mockMarkTableJobRunning.mock.calls[0]
    expect(tableId).toBe('tbl_1')
    expect(workspaceId).toBe('workspace-1')
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'email', op: 'eq', value: 'x' }] },
          data: { email: 'y' },
        },
      },
      buildToolContext()
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          data: { age: 1 },
        },
      },
      buildToolContext()
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
        args: {
          tableId: 'tbl_1',
          filter: { all: [{ field: 'name', op: 'eq', value: 'x' }] },
          data: { age: 1 },
          limit: 100,
        },
      },
      buildToolContext()
    )
    expect(result.success).toBe(true)
    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockUpdateRowsByFilter).toHaveBeenCalledTimes(1)
  })
})

describe('userTableServerTool.update_column — select routing', () => {
  const selectTable = buildTable({
    schema: {
      columns: [
        {
          id: 'col_status',
          name: 'status',
          type: 'select',
          options: [{ id: 'opt_open', name: 'Open' }],
        },
      ],
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(selectTable)
    mockUpdateColumnOptions.mockResolvedValue(selectTable)
    mockUpdateColumnType.mockResolvedValue(selectTable)
  })

  it('routes an unchanged type with options to updateColumnOptions', async () => {
    // `updateColumnType` early-returns when the type is unchanged, so routing
    // there would silently drop the new option set and still report success.
    await userTableServerTool.execute(
      {
        operation: 'update_column',
        args: {
          tableId: 'tbl_1',
          columnName: 'status',
          newType: 'select',
          options: ['Open', 'Closed'],
        },
      },
      buildToolContext()
    )

    expect(mockUpdateColumnType).not.toHaveBeenCalled()
    expect(mockUpdateColumnOptions).toHaveBeenCalledTimes(1)
    expect(
      mockUpdateColumnOptions.mock.calls[0][0].options.map((o: { name: string }) => o.name)
    ).toEqual(['Open', 'Closed'])
  })

  it('routes a genuine type change to updateColumnType', async () => {
    await userTableServerTool.execute(
      {
        operation: 'update_column',
        args: { tableId: 'tbl_1', columnName: 'status', newType: 'string' },
      },
      buildToolContext()
    )

    expect(mockUpdateColumnType).toHaveBeenCalledTimes(1)
    expect(mockUpdateColumnOptions).not.toHaveBeenCalled()
  })

  it('accepts a multiple-only toggle by reusing the current options', async () => {
    await userTableServerTool.execute(
      {
        operation: 'update_column',
        args: { tableId: 'tbl_1', columnName: 'status', multiple: true },
      },
      buildToolContext()
    )

    expect(mockUpdateColumnOptions).toHaveBeenCalledTimes(1)
    const arg = mockUpdateColumnOptions.mock.calls[0][0]
    expect(arg.multiple).toBe(true)
    expect(arg.options).toEqual([{ id: 'opt_open', name: 'Open' }])
  })
})

describe('userTableServerTool.delete bounds', () => {
  it('rejects an unbounded multi-table delete before invoking an application use case', async () => {
    vi.clearAllMocks()
    const result = await userTableServerTool.execute(
      {
        operation: 'delete',
        args: { tableIds: Array.from({ length: 101 }, (_, index) => `table-${index}`) },
      },
      buildToolContext()
    )

    expect(result).toEqual({
      success: false,
      message: 'Cannot delete more than 100 tables at once',
    })
    expect(mockGetTableById).not.toHaveBeenCalled()
  })
})

/**
 * Copilot is the one row-write surface whose column keys come from a model rather
 * than from the schema, so `dataKeying: 'names'` is what stands between an
 * LLM-authored key and the storage column it means.
 *
 * These pin the translated outcome rather than the literal: the shared `buildTable`
 * fixture uses legacy columns with no `id`, where name-to-id mapping is the identity
 * and flipping the keying is unobservable. Columns whose `id` differs from `name` are
 * what make the wrong keying fail — under `'ids'` the lax write path stores the
 * model's key verbatim and reports success, corrupting the row silently.
 */
describe('userTableServerTool row writes key model-supplied columns by name', () => {
  const KEYED_TABLE = buildTable({
    schema: {
      columns: [
        { id: 'col_name', name: 'name', type: 'string', required: true },
        { id: 'col_age', name: 'age', type: 'number' },
      ],
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(KEYED_TABLE)
  })

  it('translates an inserted row to storage column ids', async () => {
    mockInsertRow.mockResolvedValue({
      id: 'row-1',
      data: { col_name: 'Ada', col_age: 36 },
      position: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })

    await userTableServerTool.execute(
      {
        operation: 'insert_row',
        args: { tableId: 'tbl_1', data: { name: 'Ada', age: 36 } },
      },
      buildToolContext()
    )

    expect(mockInsertRow).toHaveBeenCalledTimes(1)
    expect(mockInsertRow.mock.calls[0][0].data).toEqual({ col_name: 'Ada', col_age: 36 })
  })

  it('translates an updated row to storage column ids', async () => {
    mockUpdateRow.mockResolvedValue({
      id: 'row-1',
      data: { col_name: 'Grace' },
      position: 0,
      executions: {},
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })

    await userTableServerTool.execute(
      {
        operation: 'update_row',
        args: { tableId: 'tbl_1', rowId: 'row-1', data: { name: 'Grace' } },
      },
      buildToolContext()
    )

    expect(mockUpdateRow).toHaveBeenCalledTimes(1)
    expect(mockUpdateRow.mock.calls[0][0].data).toEqual({ col_name: 'Grace' })
  })
})
