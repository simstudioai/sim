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
  mockRecordImportRejections,
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
  mockRecordImportRejections: vi.fn(),
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
  markJobFailedInWorkspace: mockMarkJobFailed,
  markJobReadyInWorkspace: mockMarkJobReady,
  recordImportRejections: mockRecordImportRejections,
  updateJobProgressInWorkspace: mockUpdateJobProgress,
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
vi.mock('@/lib/table/wire', () => ({
  normalizeColumn: (col: unknown) => col,
}))

import { CSV_MAX_BATCH_SIZE_BYTES, CSV_SCHEMA_SAMPLE_SIZE } from '@/lib/table/import'
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
    mockRecordImportRejections.mockResolvedValue(undefined)
  })

  it('fails an insert-locked replace before anything is deleted', async () => {
    // `deleteAllTableRows` only asserts the delete lock, so without an up-front
    // insert assert a replace on an insert-locked table would wipe every row
    // and then fail on the first insert, leaving the table empty.
    mockGetTableById.mockResolvedValue({
      ...table,
      locks: { schemaLocked: false, insertLocked: true, updateLocked: false, deleteLocked: false },
    })

    mockMarkJobFailed.mockResolvedValue(undefined)

    await runTableImport(buildPayload({ mode: 'replace' }))

    expect(mockMarkJobFailed).toHaveBeenCalledWith(
      'tbl_1',
      'ws_1',
      'job_1',
      expect.stringMatching(/insert-locked/i)
    )
    // Bailed before the file was even read, so the delete could never run.
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
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

  it('flushes retained records before the serialized batch byte budget is exceeded', async () => {
    const cell = 'x'.repeat(390 * 1024)
    const csv = `name\n${Array.from({ length: 14 }, () => cell).join('\n')}\n`
    mockHeadObject.mockResolvedValue({ size: Buffer.byteLength(csv) })
    mockDownloadFileStream.mockResolvedValue(Readable.from(csv))
    mockBulkInsertImportBatch.mockImplementation(async ({ rows }) => ({
      inserted: rows.length,
      lastOrderKey: 'a1',
    }))

    await runTableImport(buildPayload())

    expect(mockBulkInsertImportBatch).toHaveBeenCalledTimes(2)
    for (const [input] of mockBulkInsertImportBatch.mock.calls) {
      const retainedBytes = input.rows.reduce(
        (total: number, row: Record<string, unknown>) =>
          total + Buffer.byteLength(JSON.stringify(row), 'utf8'),
        0
      )
      expect(retainedBytes).toBeLessThanOrEqual(CSV_MAX_BATCH_SIZE_BYTES)
    }
  })
})

describe('runTableImport rejection accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockHeadObject.mockResolvedValue({ size: 100 })
    mockNextImportStartPosition.mockResolvedValue(0)
    mockNextImportStartOrderKey.mockResolvedValue(null)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockBulkInsertImportBatch.mockImplementation(async ({ rows }: { rows: unknown[] }) => ({
      inserted: rows.length,
      lastOrderKey: 'a1',
    }))
    mockMarkJobReady.mockResolvedValue(true)
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
    mockRecordImportRejections.mockResolvedValue(undefined)
  })

  it('records the records a malformed CSV silently loses', async () => {
    // The unterminated quote swallows the rest of the file, so csv-parse drops both
    // remaining data rows. Without an accounting of that the import reports `ready`
    // with one row and no error — indistinguishable from a one-row file.
    const csv = 'name\nOk\nBroken,"unterminated\nAnother\n'
    mockHeadObject.mockResolvedValue({ size: Buffer.byteLength(csv) })
    mockDownloadFileStream.mockResolvedValue(Readable.from(csv))

    await runTableImport(buildPayload())

    expect(mockMarkJobReady).toHaveBeenCalled()
    expect(mockRecordImportRejections).toHaveBeenCalledWith(
      'tbl_1',
      'ws_1',
      'job_1',
      expect.objectContaining({ rowsRejected: 1, cellsRejected: 0 })
    )
    const [, , , summary] = mockRecordImportRejections.mock.calls[0]
    expect(summary.rejectedSamples).toHaveLength(1)
    expect(summary.rejectedSamples[0]).toMatchObject({ code: 'CSV_QUOTE_NOT_CLOSED' })
  })

  it('does not count blanked cells for a batch that never landed', async () => {
    // The coercion hook fires while the batch is being prepared, before the capacity check
    // and the insert. Counting there persists loss for rows the table never received.
    mockGetTableById.mockResolvedValue({
      ...table,
      schema: { columns: [{ id: 'col_score', name: 'score', type: 'number' }] },
    })
    const csv = 'score\n1\nnot-a-number\n3\n'
    mockHeadObject.mockResolvedValue({ size: Buffer.byteLength(csv) })
    mockDownloadFileStream.mockResolvedValue(Readable.from(csv))
    mockBulkInsertImportBatch.mockRejectedValue(new Error('insert failed'))

    await runTableImport(buildPayload())

    expect(mockMarkJobFailed).toHaveBeenCalled()
    expect(mockRecordImportRejections).not.toHaveBeenCalled()
  })

  it('releases the storage stream before writing the rejection summary', async () => {
    mockGetTableById.mockResolvedValue({
      ...table,
      schema: { columns: [{ id: 'col_score', name: 'score', type: 'number' }] },
    })
    const cell = 'x'.repeat(390 * 1024)
    // Never ended, and the run stops on a lost ownership gate rather than end-of-stream, so
    // the storage response body is still open when the `finally` runs — the only state in
    // which the summary write can be seen holding that connection.
    const source = new Readable({ read() {} })
    source.push(`score\n${Array.from({ length: 40 }, () => cell).join('\n')}\n`)
    mockHeadObject.mockResolvedValue({ size: 400 * 1024 * 1024 })
    mockDownloadFileStream.mockResolvedValue(source)
    mockBulkInsertImportBatch.mockImplementation(async ({ rows }: { rows: unknown[] }) => ({
      inserted: rows.length,
      lastOrderKey: 'a1',
    }))
    // Startup, schema resolution, the first batch's gate and its emit-cadence write all own
    // the run; the second batch's gate finds it lost and stops mid-stream.
    mockUpdateJobProgress
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    let destroyedWhenRecording: boolean | null = null
    mockRecordImportRejections.mockImplementation(async () => {
      destroyedWhenRecording = source.destroyed
    })

    await runTableImport(buildPayload())

    expect(mockRecordImportRejections).toHaveBeenCalled()
    expect(destroyedWhenRecording).toBe(true)
  })

  it('records cell values the target column type could not hold', async () => {
    mockGetTableById.mockResolvedValue({
      ...table,
      schema: { columns: [{ id: 'col_score', name: 'score', type: 'number' }] },
    })
    const csv = 'score\n1\nnot-a-number\n3\n'
    mockHeadObject.mockResolvedValue({ size: Buffer.byteLength(csv) })
    mockDownloadFileStream.mockResolvedValue(Readable.from(csv))

    await runTableImport(buildPayload())

    expect(mockRecordImportRejections).toHaveBeenCalledWith(
      'tbl_1',
      'ws_1',
      'job_1',
      expect.objectContaining({ rowsRejected: 0, cellsRejected: 1 })
    )
  })

  it('records nothing for a clean import', async () => {
    mockDownloadFileStream.mockResolvedValue(Readable.from('name\nAlice\nBob\n'))

    await runTableImport(buildPayload())

    expect(mockMarkJobReady).toHaveBeenCalled()
    expect(mockRecordImportRejections).not.toHaveBeenCalled()
  })
})

describe('runTableImport in-flight progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockNextImportStartPosition.mockResolvedValue(0)
    mockNextImportStartOrderKey.mockResolvedValue(null)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockMarkJobReady.mockResolvedValue(true)
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
    mockRecordImportRejections.mockResolvedValue(undefined)
  })

  it('writes progress once per batch rather than twice', async () => {
    const cell = 'x'.repeat(390 * 1024)
    const csv = `name\n${Array.from({ length: 14 }, () => cell).join('\n')}\n`
    mockHeadObject.mockResolvedValue({ size: Buffer.byteLength(csv) })
    mockDownloadFileStream.mockResolvedValue(Readable.from(csv))
    mockBulkInsertImportBatch.mockImplementation(async ({ rows }: { rows: unknown[] }) => ({
      inserted: rows.length,
      lastOrderKey: 'a1',
    }))

    await runTableImport(buildPayload())

    expect(mockBulkInsertImportBatch).toHaveBeenCalledTimes(2)
    // Startup, schema resolution, one ownership gate per batch, one emit-cadence write (the
    // first batch always emits), and the terminal write. An unconditional post-insert write
    // per batch doubles an import's UPDATE volume — ~400 writes on a 1M-row file instead of
    // ~200 — to freshen a display counter the next batch's gate refreshes anyway.
    expect(mockUpdateJobProgress).toHaveBeenCalledTimes(6)
  })

  it('persists the post-insert count so an interrupted import reports committed rows', async () => {
    // The ownership gate necessarily writes the count as it stood *before* its batch, so a run
    // interrupted while reading the next batch would otherwise leave `rows_processed` a whole
    // batch behind the rows it actually committed.
    const cell = 'x'.repeat(1024)
    // Enough rows to fill the schema sample (so one batch commits) and larger than the
    // delimiter sniff window (so the sniffer stops on the window rather than waiting for an
    // end-of-stream that never comes).
    const rows = Array.from({ length: CSV_SCHEMA_SAMPLE_SIZE + 50 }, () => cell)
    const head = `name\n${rows.join('\n')}\n`
    const source = new Readable({ read() {} })
    source.push(head)
    mockHeadObject.mockResolvedValue({ size: Buffer.byteLength(head) * 10 })
    mockDownloadFileStream.mockResolvedValue(source)
    mockBulkInsertImportBatch.mockImplementation(async ({ rows }: { rows: unknown[] }) => {
      // The source dies while the worker waits for the next batch's records.
      setImmediate(() => source.destroy(new Error('storage stream reset')))
      return { inserted: rows.length, lastOrderKey: 'a1' }
    })

    await runTableImport(buildPayload())

    expect(mockBulkInsertImportBatch).toHaveBeenCalledTimes(1)
    expect(mockMarkJobFailed).toHaveBeenCalled()
    const persisted = mockUpdateJobProgress.mock.calls.map((call) => call[2])
    expect(Math.max(...persisted)).toBe(CSV_SCHEMA_SAMPLE_SIZE)
  })
})
