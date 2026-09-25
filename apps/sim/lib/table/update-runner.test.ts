import { tableConstantsMock } from '@sim/testing/mocks/table-constants.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import {
  tableJobsServiceMock,
  tableJobsServiceMockFns,
} from '@sim/testing/mocks/table-jobs-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelectRowDataPage,
  mockUpdatePageByIds,
  mockBuildFilterClause,
  mockValidateRowSize,
  mockCoerceRowToSchema,
  mockCoerceRowValues,
} = vi.hoisted(() => ({
  mockSelectRowDataPage: vi.fn(),
  mockUpdatePageByIds: vi.fn(),
  mockBuildFilterClause: vi.fn(),
  mockValidateRowSize: vi.fn(),
  mockCoerceRowToSchema: vi.fn(),
  mockCoerceRowValues: vi.fn(),
}))

vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
vi.mock('@/lib/table/rows/ordering', () => ({
  selectRowDataPage: mockSelectRowDataPage,
  updatePageByIds: mockUpdatePageByIds,
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/sql', () => ({ buildFilterClause: mockBuildFilterClause }))
vi.mock('@/lib/table/validation', () => ({
  validateRowSize: mockValidateRowSize,
  coerceRowToSchema: mockCoerceRowToSchema,
  coerceRowValues: mockCoerceRowValues,
}))
vi.mock('@/lib/table/constants', () => ({
  ...tableConstantsMock,
  TABLE_LIMITS: { ...tableConstantsMock.TABLE_LIMITS, DELETE_PAGE_SIZE: 2, UPDATE_BATCH_SIZE: 100 },
}))

import { runTableUpdate } from '@/lib/table/update-runner'

const mockGetTableById = tableServiceMockFns.mockGetTableById
const mockGetJobProgress = tableJobsServiceMockFns.mockGetJobProgress
const mockUpdateJobProgress = tableJobsServiceMockFns.mockUpdateJobProgress
const mockMarkJobReady = tableJobsServiceMockFns.mockMarkJobReady
const mockMarkJobFailed = tableJobsServiceMockFns.mockMarkJobFailed
const mockMarkJobCanceled = tableJobsServiceMockFns.mockMarkJobCanceled
const mockAppendTableEvent = tableEventsMockFns.mockAppendTableEvent

const UNLOCKED = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}
const table = { id: 'tbl_1', workspaceId: 'ws_1', schema: { columns: [] }, locks: UNLOCKED }
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

  it('cancels without updating when the table was update-locked before the run started', async () => {
    // The lock is asserted at enqueue, but a queued or retried job can start
    // after an admin locks the table — nothing is written yet, so honor it.
    mockGetTableById.mockResolvedValue({ ...table, locks: { ...UNLOCKED, updateLocked: true } })
    mockSelectRowDataPage.mockResolvedValue([row('a')])

    await expect(runTableUpdate(basePayload())).resolves.toBeUndefined()

    expect(mockUpdatePageByIds).not.toHaveBeenCalled()
    expect(mockMarkJobCanceled).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockMarkJobReady).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'update', status: 'canceled' })
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
})
