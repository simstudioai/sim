/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetTableById,
  mockBulkInsertImportBatch,
  mockUpdateJobProgress,
  mockMarkJobReady,
  mockMarkJobFailed,
  mockNextImportStartPosition,
  mockNextImportStartOrderKey,
  mockAppendTableEvent,
  mockDeleteFile,
  mockDownloadFileStream,
  mockHeadObject,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockBulkInsertImportBatch: vi.fn(),
  mockUpdateJobProgress: vi.fn(),
  mockMarkJobReady: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockNextImportStartPosition: vi.fn(),
  mockNextImportStartOrderKey: vi.fn(),
  mockAppendTableEvent: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDownloadFileStream: vi.fn(),
  mockHeadObject: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))
vi.mock('@/lib/table/import-data', () => ({
  addImportColumns: vi.fn(),
  bulkInsertImportBatch: mockBulkInsertImportBatch,
  deleteAllTableRows: vi.fn(),
  setTableSchemaForImport: vi.fn(),
}))
vi.mock('@/lib/table/jobs/service', () => ({
  markJobFailed: mockMarkJobFailed,
  markJobReady: mockMarkJobReady,
  updateJobProgress: mockUpdateJobProgress,
}))
vi.mock('@/lib/table/rows/ordering', () => ({
  nextImportStartOrderKey: mockNextImportStartOrderKey,
  nextImportStartPosition: mockNextImportStartPosition,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: mockDeleteFile,
  downloadFileStream: mockDownloadFileStream,
  headObject: mockHeadObject,
}))
vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: (col: unknown) => col,
}))

import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'

const table = {
  id: 'tbl_1',
  name: 'People',
  workspaceId: 'ws_1',
  rowCount: 0,
  maxRows: 1000,
  schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
}

function buildPayload(overrides: Partial<TableImportPayload> = {}): TableImportPayload {
  return {
    importId: 'job_1',
    tableId: 'tbl_1',
    workspaceId: 'ws_1',
    userId: 'user_1',
    fileKey: 'workspace/ws_1/people.csv',
    fileName: 'people.csv',
    delimiter: ',',
    mode: 'append',
    ...overrides,
  }
}

describe('runTableImport source-file cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockHeadObject.mockResolvedValue({ size: 20 })
    mockDownloadFileStream.mockResolvedValue(Readable.from('name\nAlice\nBob\n'))
    mockNextImportStartPosition.mockResolvedValue(0)
    mockNextImportStartOrderKey.mockResolvedValue(null)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockBulkInsertImportBatch.mockResolvedValue({ inserted: 2, lastOrderKey: 'a1' })
    mockMarkJobReady.mockResolvedValue(true)
    mockDeleteFile.mockResolvedValue(undefined)
  })

  it('deletes the single-use source object by default', async () => {
    await runTableImport(buildPayload())

    expect(mockMarkJobReady).toHaveBeenCalled()
    expect(mockDeleteFile).toHaveBeenCalledWith({
      key: 'workspace/ws_1/people.csv',
      context: 'workspace',
    })
  })

  it('keeps a persistent workspace file when deleteSourceFile is false', async () => {
    await runTableImport(buildPayload({ deleteSourceFile: false }))

    expect(mockMarkJobReady).toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })
})
