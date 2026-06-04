/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFindUpload,
  mockFetchBuffer,
  mockParseFileRows,
  mockInferSchema,
  mockCoerceRows,
  mockCreateTable,
  mockBatchInsertRows,
  mockDeleteTable,
  mockGetLimits,
} = vi.hoisted(() => ({
  mockFindUpload: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockParseFileRows: vi.fn(),
  mockInferSchema: vi.fn(),
  mockCoerceRows: vi.fn(),
  mockCreateTable: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetLimits: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  findMothershipUploadRowByChatAndName: mockFindUpload,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: () => '/api/files/serve/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchBuffer,
}))

vi.mock('@/lib/table', () => ({
  CSV_MAX_BATCH_SIZE: 1000,
  TABLE_LIMITS: { MAX_TABLE_NAME_LENGTH: 100 },
  parseFileRows: mockParseFileRows,
  inferSchemaFromCsv: mockInferSchema,
  coerceRowsForTable: mockCoerceRows,
  createTable: mockCreateTable,
  batchInsertRows: mockBatchInsertRows,
  deleteTable: mockDeleteTable,
  getWorkspaceTableLimits: mockGetLimits,
  sanitizeName: (raw: string) => raw.replace(/[^a-zA-Z0-9_]/g, '_'),
}))

vi.mock('@/lib/workflows/operations/import-export', () => ({ parseWorkflowJson: vi.fn() }))
vi.mock('@/lib/workflows/persistence/utils', () => ({ saveWorkflowToNormalizedTables: vi.fn() }))
vi.mock('@/lib/workflows/utils', () => ({ deduplicateWorkflowName: vi.fn() }))
vi.mock('@/app/api/v1/admin/types', () => ({ extractWorkflowMetadata: vi.fn() }))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeMaterializeFile } from '@/lib/copilot/tools/handlers/materialize-file'

const context = {
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  workflowId: 'wf-1',
} as ExecutionContext

const uploadRow = {
  id: 'file-1',
  workspaceId: 'ws-1',
  displayName: 'data.csv',
  originalName: 'data.csv',
  key: 'uploads/data.csv',
  size: 123,
  contentType: 'text/csv',
  userId: 'user-1',
  deletedAt: null,
  uploadedAt: new Date(),
  updatedAt: new Date(),
}

describe('executeMaterializeFile - table operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUpload.mockResolvedValue(uploadRow)
    mockFetchBuffer.mockResolvedValue(Buffer.from('name\nAlice'))
    mockParseFileRows.mockResolvedValue({ headers: ['name'], rows: [{ name: 'Alice' }] })
    mockInferSchema.mockReturnValue({
      columns: [{ name: 'name', type: 'string' }],
      headerToColumn: new Map([['name', 'name']]),
    })
    mockCoerceRows.mockReturnValue([{ name: 'Alice' }])
    mockGetLimits.mockResolvedValue({ maxRowsPerTable: 1_000_000, maxTables: 50 })
    mockCreateTable.mockResolvedValue({ id: 'tbl_abc', name: 'data', schema: { columns: [] } })
    mockBatchInsertRows.mockResolvedValue([{ id: 'row-1' }])
    mockDeleteTable.mockResolvedValue(undefined)
  })

  it('creates a table and returns a table resource', async () => {
    const result = await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'table' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockCreateTable).toHaveBeenCalledTimes(1)
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'data',
        workspaceId: 'ws-1',
        userId: 'user-1',
        maxRows: 1_000_000,
        maxTables: 50,
      }),
      expect.any(String)
    )
    expect(result.resources).toEqual([{ type: 'table', id: 'tbl_abc', title: 'data' }])
    expect((result.output as { succeeded: string[] }).succeeded).toEqual(['data.csv'])
  })

  it('honors an explicit tableName', async () => {
    await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'table', tableName: 'My Customers' },
      context
    )
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My_Customers' }),
      expect.any(String)
    )
  })

  it('deletes the table and fails when row insertion throws', async () => {
    mockBatchInsertRows.mockRejectedValueOnce(new Error('insert exploded'))

    const result = await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'table' },
      context
    )

    expect(result.success).toBe(false)
    expect(mockDeleteTable).toHaveBeenCalledWith('tbl_abc', expect.any(String))
    expect((result.output as { failed: Array<{ error: string }> }).failed[0].error).toContain(
      'insert exploded'
    )
  })

  it('fails fast (no table created) when the upload is missing', async () => {
    mockFindUpload.mockResolvedValue(null)

    const result = await executeMaterializeFile(
      { fileNames: ['missing.csv'], operation: 'table' },
      context
    )

    expect(result.success).toBe(false)
    expect(mockCreateTable).not.toHaveBeenCalled()
    expect((result.output as { failed: Array<{ error: string }> }).failed[0].error).toContain(
      'Upload not found'
    )
  })
})

describe('executeMaterializeFile - unsupported operation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an unimplemented operation instead of silently saving', async () => {
    const result = await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'knowledge_base' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not implemented')
    expect(mockFindUpload).not.toHaveBeenCalled()
    expect(mockCreateTable).not.toHaveBeenCalled()
  })
})
