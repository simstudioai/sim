/**
 * @vitest-environment node
 *
 * CSV import orchestration — the logic both the first-party and public import
 * routes delegate to, so neither can drift on what an import actually does.
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMarkTableJobRunning,
  mockReleaseJobClaim,
  mockImportAppendRows,
  mockImportReplaceRows,
  mockGetMaxRowsPerTable,
  mockDispatchAfterBatchInsert,
  mockSignalSchemaChanged,
  mockGetWorkspaceTableLimits,
  mockBatchInsertRows,
  mockCreateTable,
  mockDeleteTable,
} = vi.hoisted(() => ({
  mockMarkTableJobRunning: vi.fn(),
  mockReleaseJobClaim: vi.fn(),
  mockImportAppendRows: vi.fn(),
  mockImportReplaceRows: vi.fn(),
  mockGetMaxRowsPerTable: vi.fn(),
  mockDispatchAfterBatchInsert: vi.fn(),
  mockSignalSchemaChanged: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockCreateTable: vi.fn(),
  mockDeleteTable: vi.fn(),
}))

vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunning: mockMarkTableJobRunning,
  releaseJobClaim: mockReleaseJobClaim,
}))
vi.mock('@/lib/table/import-data', () => ({
  importAppendRows: mockImportAppendRows,
  importReplaceRows: mockImportReplaceRows,
}))
vi.mock('@/lib/table/billing', () => ({
  getMaxRowsPerTable: mockGetMaxRowsPerTable,
  getWorkspaceTableLimits: mockGetWorkspaceTableLimits,
  wouldExceedRowLimit: (limit: number, current: number, added: number) =>
    limit >= 0 && current + added > limit,
}))
vi.mock('@/lib/table/rows/service', () => ({
  batchInsertRows: mockBatchInsertRows,
  dispatchAfterBatchInsert: mockDispatchAfterBatchInsert,
}))
vi.mock('@/lib/table/service', () => ({
  createTable: mockCreateTable,
  deleteTable: mockDeleteTable,
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mockSignalSchemaChanged }))

import { performCreateTableFromCsv, performTableCsvImport } from '@/lib/table/orchestration/import'

const TABLE = {
  id: 'table-1',
  name: 'contacts',
  workspaceId: 'ws-1',
  rowCount: 10,
  archivedAt: null,
  jobStatus: null,
  schema: {
    columns: [
      { id: 'col_email', name: 'email', type: 'string', required: false, unique: false },
      { id: 'col_name', name: 'name', type: 'string', required: false, unique: false },
    ],
  },
} as never

const CSV = 'email,name\na@b.c,Ann\nd@e.f,Dan\n'

function csvStream(text = CSV) {
  return Readable.from([Buffer.from(text)])
}

function importParams(overrides: Record<string, unknown> = {}) {
  return {
    table: TABLE,
    workspaceId: 'ws-1',
    userId: 'user-1',
    fileStream: csvStream(),
    fileName: 'contacts.csv',
    fallbackDelimiter: ',' as const,
    mode: 'append' as const,
    timezone: 'UTC',
    requestId: 'req-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkTableJobRunning.mockResolvedValue(true)
  mockReleaseJobClaim.mockResolvedValue(undefined)
  mockGetMaxRowsPerTable.mockResolvedValue(1000)
  mockImportAppendRows.mockResolvedValue({
    inserted: [{ id: 'row-1' }, { id: 'row-2' }],
    table: TABLE,
  })
  mockImportReplaceRows.mockResolvedValue({ insertedCount: 2, deletedCount: 10 })
  mockGetWorkspaceTableLimits.mockResolvedValue({ maxTables: 10, maxRowsPerTable: 1000 })
  mockCreateTable.mockResolvedValue(TABLE)
  mockDeleteTable.mockResolvedValue(undefined)
  mockBatchInsertRows.mockImplementation(async ({ rows }: { rows: unknown[] }) =>
    rows.map((_, index) => ({ id: `row-${index}` }))
  )
})

describe('performTableCsvImport', () => {
  it('auto-maps same-named headers and appends the parsed rows', async () => {
    const result = await performTableCsvImport(importParams())

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      tableId: 'table-1',
      mode: 'append',
      insertedCount: 2,
      mappedColumns: ['email', 'name'],
      skippedHeaders: [],
      unmappedColumns: [],
      sourceFile: 'contacts.csv',
    })
    // The trigger/scheduler fan-out must run AFTER the tx commits, so it is the
    // orchestration's job rather than the writer's.
    expect(mockDispatchAfterBatchInsert).toHaveBeenCalled()
    expect(mockSignalSchemaChanged).toHaveBeenCalledWith('table-1')
  })

  it('reports the deleted count on a replace', async () => {
    const result = await performTableCsvImport(importParams({ mode: 'replace' }))

    expect(result.data).toMatchObject({ mode: 'replace', insertedCount: 2, deletedCount: 10 })
    expect(mockImportReplaceRows).toHaveBeenCalled()
    expect(mockImportAppendRows).not.toHaveBeenCalled()
  })

  it('holds the table job slot for the write and releases it before returning', async () => {
    await performTableCsvImport(importParams())

    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('table-1', expect.any(String), 'import')
    // Released before the response, so a client refetch never observes the claim.
    expect(mockReleaseJobClaim).toHaveBeenCalledWith('table-1', expect.any(String))
  })

  it('releases the claim even when the write throws', async () => {
    mockImportAppendRows.mockRejectedValue(new Error('boom'))

    const result = await performTableCsvImport(importParams())

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('internal')
    expect(mockReleaseJobClaim).toHaveBeenCalled()
  })

  it('refuses when another job already holds the slot', async () => {
    mockMarkTableJobRunning.mockResolvedValue(false)

    const result = await performTableCsvImport(importParams())

    expect(result).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockImportAppendRows).not.toHaveBeenCalled()
    // Nothing was claimed, so nothing may be released — releasing here would
    // free the *other* job's slot.
    expect(mockReleaseJobClaim).not.toHaveBeenCalled()
  })

  it('refuses an import that would exceed the plan row limit, before writing', async () => {
    mockGetMaxRowsPerTable.mockResolvedValue(11)

    const result = await performTableCsvImport(importParams())

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.error).toContain('exceed table row limit')
    expect(mockImportAppendRows).not.toHaveBeenCalled()
  })

  it('rejects an archived table and a table with a job already running', async () => {
    const archived = await performTableCsvImport(
      importParams({ table: { ...TABLE, archivedAt: new Date() } })
    )
    expect(archived).toMatchObject({ success: false, errorCode: 'validation' })

    const busy = await performTableCsvImport(
      importParams({ table: { ...TABLE, jobStatus: 'running' } })
    )
    expect(busy).toMatchObject({ success: false, errorCode: 'conflict' })

    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('rejects a file with no data rows', async () => {
    const result = await performTableCsvImport(
      importParams({ fileStream: csvStream('email,name\n') })
    )

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.error).toBe('CSV file has no data rows')
  })

  it('rejects a file whose headers map to nothing on the table', async () => {
    const result = await performTableCsvImport(
      importParams({ fileStream: csvStream('alpha,beta\n1,2\n') })
    )

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.error).toContain('No CSV headers map to columns')
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('reports which headers were skipped and which columns went unfilled', async () => {
    const result = await performTableCsvImport(
      importParams({
        fileStream: csvStream('email,notes\na@b.c,hi\n'),
        mapping: { email: 'email', notes: null },
      })
    )

    expect(result.data).toMatchObject({
      mappedColumns: ['email'],
      skippedHeaders: ['notes'],
      unmappedColumns: ['name'],
    })
  })

  /**
   * The parser drops malformed records silently, so a buffered import used to
   * finish with a smaller table and nothing distinguishing it from a clean one.
   */
  describe('rejection accounting', () => {
    it('reports the records a malformed CSV silently dropped', async () => {
      const result = await performTableCsvImport(
        importParams({
          fileStream: csvStream('email,name\na@b.c,Ann\nd@e.f,"unterminated\ng@h.i,Gil\n'),
        })
      )

      expect(result.success).toBe(true)
      expect(result.data?.rejections?.rowsRejected).toBeGreaterThan(0)
      expect(result.data?.rejections?.rejectedSamples[0]).toMatchObject({
        code: 'CSV_QUOTE_NOT_CLOSED',
      })
    })

    it('counts cells the target column type could not represent', async () => {
      const result = await performTableCsvImport(
        importParams({
          table: {
            ...TABLE,
            schema: {
              columns: [
                { id: 'col_age', name: 'age', type: 'number', required: false, unique: false },
              ],
            },
          },
          fileStream: csvStream('age\n42\nnot-a-number\n'),
        })
      )

      expect(result.success).toBe(true)
      expect(result.data?.rejections).toEqual({
        rowsRejected: 0,
        cellsRejected: 1,
        rejectedSamples: [],
      })
    })

    it('omits the accounting entirely from a clean import', async () => {
      const result = await performTableCsvImport(importParams())

      expect(result.data).not.toHaveProperty('rejections')
    })
  })

  it('rejects createColumns naming a header the file does not have', async () => {
    const result = await performTableCsvImport(importParams({ createColumns: ['phone'] }))

    expect(result).toMatchObject({ success: false, errorCode: 'validation' })
    expect(result.error).toContain('unknown CSV headers')
  })

  it('creates the requested columns with ids the coerced rows already key by', async () => {
    const result = await performTableCsvImport(
      importParams({ fileStream: csvStream('email,phone\na@b.c,555\n'), createColumns: ['phone'] })
    )

    expect(result.success).toBe(true)
    const [, additions, rows] = mockImportAppendRows.mock.calls[0]
    expect(additions).toEqual([{ id: expect.any(String), name: 'phone', type: expect.any(String) }])
    // The id is pre-assigned so the prospective schema used to coerce and the
    // column the write creates share one key — otherwise the values land under
    // a key nothing reads.
    expect(Object.keys(rows[0])).toContain(additions[0].id)
  })
})

describe('performCreateTableFromCsv', () => {
  function createParams(text: string) {
    return {
      workspaceId: 'ws-1',
      userId: 'user-1',
      fileStream: csvStream(text),
      fileName: 'contacts.csv',
      fallbackDelimiter: ',' as const,
      folderId: null,
      timezone: 'UTC',
      requestId: 'req-1',
    }
  }

  it('reports the records a malformed CSV silently dropped', async () => {
    const result = await performCreateTableFromCsv(
      createParams('email,name\na@b.c,Ann\nd@e.f,"unterminated\ng@h.i,Gil\n')
    )

    expect(result.success).toBe(true)
    expect(result.data?.rejections?.rowsRejected).toBeGreaterThan(0)
    expect(result.data?.rejections?.rejectedSamples[0]).toMatchObject({
      code: 'CSV_QUOTE_NOT_CLOSED',
    })
  })

  it('omits the accounting entirely from a clean import', async () => {
    const result = await performCreateTableFromCsv(createParams(CSV))

    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('rejections')
  })
})
