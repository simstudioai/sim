/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetTableById,
  mockGetJobProgress,
  mockSelectRowDataPage,
  mockUpdatePageByIds,
  mockUpdateJobProgress,
  mockMarkJobReady,
  mockMarkJobFailed,
  mockAppendTableEvent,
  mockBuildFilterClause,
  mockValidateRowSize,
  mockCoerceRowToSchema,
  mockCoerceRowValues,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockGetJobProgress: vi.fn(),
  mockSelectRowDataPage: vi.fn(),
  mockUpdatePageByIds: vi.fn(),
  mockUpdateJobProgress: vi.fn(),
  mockMarkJobReady: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockAppendTableEvent: vi.fn(),
  mockBuildFilterClause: vi.fn(),
  mockValidateRowSize: vi.fn(),
  mockCoerceRowToSchema: vi.fn(),
  mockCoerceRowValues: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({ getTableById: mockGetTableById }))
vi.mock('@/lib/table/jobs/service', () => ({
  getJobProgress: mockGetJobProgress,
  updateJobProgress: mockUpdateJobProgress,
  markJobReady: mockMarkJobReady,
  markJobFailed: mockMarkJobFailed,
}))
vi.mock('@/lib/table/rows/ordering', () => ({
  selectRowDataPage: mockSelectRowDataPage,
  updatePageByIds: mockUpdatePageByIds,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/lib/table/sql', () => ({ buildFilterClause: mockBuildFilterClause }))
vi.mock('@/lib/table/validation', () => ({
  validateRowSize: mockValidateRowSize,
  coerceRowToSchema: mockCoerceRowToSchema,
  coerceRowValues: mockCoerceRowValues,
}))
vi.mock('@/lib/table/constants', () => ({
  TABLE_LIMITS: { DELETE_PAGE_SIZE: 2, UPDATE_BATCH_SIZE: 100 },
  USER_TABLE_ROWS_SQL_NAME: 'user_table_rows',
}))

import { markTableUpdateFailed, runTableUpdate } from '@/lib/table/update-runner'

const table = { id: 'tbl_1', workspaceId: 'ws_1', schema: { columns: [] } }
const cutoff = new Date('2026-06-05T00:00:00Z')

function basePayload(overrides = {}) {
  return {
    jobId: 'job_1',
    tableId: 'tbl_1',
    workspaceId: 'ws_1',
    filter: { status: 'old' },
    data: { flag: true },
    cutoff,
    ...overrides,
  }
}
const row = (id: string) => ({ id, data: {} })

describe('runTableUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockGetJobProgress.mockResolvedValue(0)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockMarkJobReady.mockResolvedValue(true)
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockUpdatePageByIds.mockImplementation((_t, _w, ids: string[]) => Promise.resolve(ids.length))
    mockBuildFilterClause.mockReturnValue({})
    mockValidateRowSize.mockReturnValue({ valid: true, errors: [] })
    mockCoerceRowToSchema.mockReturnValue({ valid: true, errors: [] })
  })

  it('updates every matching page then marks the job ready', async () => {
    mockSelectRowDataPage
      .mockResolvedValueOnce([row('a'), row('b')])
      .mockResolvedValueOnce([row('c')])
      .mockResolvedValueOnce([])

    await runTableUpdate(basePayload())

    expect(mockUpdatePageByIds).toHaveBeenNthCalledWith(
      1,
      'tbl_1',
      'ws_1',
      ['a', 'b'],
      expect.any(String)
    )
    expect(mockUpdatePageByIds).toHaveBeenNthCalledWith(
      2,
      'tbl_1',
      'ws_1',
      ['c'],
      expect.any(String)
    )
    expect(mockMarkJobReady).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'update', status: 'ready', progress: 3 })
    )
  })

  it('fails (rethrows) when a merged row is invalid, without writing that page', async () => {
    mockSelectRowDataPage.mockResolvedValueOnce([row('a')])
    mockValidateRowSize.mockReturnValueOnce({ valid: false, errors: ['row too large'] })

    await expect(runTableUpdate(basePayload())).rejects.toThrow(/Row a: row too large/)
    expect(mockUpdatePageByIds).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled() // caller decides via markTableUpdateFailed
  })

  it('stops without marking ready when the ownership gate is lost', async () => {
    mockSelectRowDataPage.mockResolvedValue([row('a'), row('b')])
    mockUpdateJobProgress.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await runTableUpdate(basePayload())

    expect(mockUpdatePageByIds).toHaveBeenCalledTimes(1)
    expect(mockMarkJobReady).not.toHaveBeenCalled()
  })

  it('rethrows the root cause so the clean message survives serialization', async () => {
    const cause = new Error('canceling statement due to statement timeout')
    mockSelectRowDataPage.mockRejectedValue(new Error('Failed query: update ...', { cause }))

    await expect(runTableUpdate(basePayload())).rejects.toThrow(
      'canceling statement due to statement timeout'
    )
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('resumes cumulative progress on retry instead of resetting to zero', async () => {
    mockGetJobProgress.mockResolvedValue(7)
    mockSelectRowDataPage.mockResolvedValueOnce([row('a'), row('b')]).mockResolvedValueOnce([])

    await runTableUpdate(basePayload())

    expect(mockUpdateJobProgress).toHaveBeenNthCalledWith(1, 'tbl_1', 7, 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', progress: 9 })
    )
  })

  it('stops at the seed read when the job is no longer owned', async () => {
    mockGetJobProgress.mockResolvedValue(null)

    await expect(runTableUpdate(basePayload())).resolves.toBeUndefined()
    expect(mockSelectRowDataPage).not.toHaveBeenCalled()
    expect(mockUpdatePageByIds).not.toHaveBeenCalled()
  })

  it('stops once maxRows is reached and never over-fetches a page', async () => {
    // budget 3 with page size 2: first page fills 2, second page is capped to the remaining 1.
    mockSelectRowDataPage
      .mockResolvedValueOnce([row('a'), row('b')])
      .mockResolvedValueOnce([row('c')])

    await runTableUpdate(basePayload({ maxRows: 3 }))

    expect(mockSelectRowDataPage).toHaveBeenCalledTimes(2)
    expect(mockSelectRowDataPage.mock.calls[0][0]).toMatchObject({ limit: 2 })
    expect(mockSelectRowDataPage.mock.calls[1][0]).toMatchObject({ limit: 1 })
    expect(mockUpdatePageByIds).toHaveBeenCalledTimes(2)
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', progress: 3 })
    )
  })

  it('passes the cutoff and filter clause through to the page query', async () => {
    mockSelectRowDataPage.mockResolvedValueOnce([])

    await runTableUpdate(basePayload())

    expect(mockBuildFilterClause).toHaveBeenCalledWith(
      { status: 'old' },
      'user_table_rows',
      table.schema.columns
    )
    expect(mockSelectRowDataPage).toHaveBeenCalledWith(
      expect.objectContaining({
        cutoff,
        filterClause: {},
        limit: 2,
        // Already-patched rows are excluded so a retry doesn't re-walk/double-count.
        excludeIfPatched: JSON.stringify({ flag: true }),
      })
    )
  })
})

describe('markTableUpdateFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkJobFailed.mockResolvedValue(undefined)
  })

  it('marks the job failed and emits the failed event', async () => {
    await markTableUpdateFailed('tbl_1', 'job_1', new Error('boom'))

    expect(mockMarkJobFailed).toHaveBeenCalledWith('tbl_1', 'job_1', 'boom')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'update', status: 'failed', error: 'boom' })
    )
  })
})
