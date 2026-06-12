/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetTableById,
  mockSelectRowIdPage,
  mockDeletePageByIds,
  mockUpdateJobProgress,
  mockMarkJobReady,
  mockMarkJobFailed,
  mockAppendTableEvent,
  mockBuildFilterClause,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockSelectRowIdPage: vi.fn(),
  mockDeletePageByIds: vi.fn(),
  mockUpdateJobProgress: vi.fn(),
  mockMarkJobReady: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockAppendTableEvent: vi.fn(),
  mockBuildFilterClause: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
  selectRowIdPage: mockSelectRowIdPage,
  deletePageByIds: mockDeletePageByIds,
  updateJobProgress: mockUpdateJobProgress,
  markJobReady: mockMarkJobReady,
  markJobFailed: mockMarkJobFailed,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/lib/table/sql', () => ({ buildFilterClause: mockBuildFilterClause }))
vi.mock('@/lib/table/constants', () => ({
  TABLE_LIMITS: { DELETE_PAGE_SIZE: 2 },
  USER_TABLE_ROWS_SQL_NAME: 'user_table_rows',
}))

import { runTableDelete } from '@/lib/table/delete-runner'

const table = { id: 'tbl_1', workspaceId: 'ws_1', schema: { columns: [] } }
const cutoff = new Date('2026-06-05T00:00:00Z')

function basePayload(overrides = {}) {
  return { jobId: 'job_1', tableId: 'tbl_1', workspaceId: 'ws_1', cutoff, ...overrides }
}

describe('runTableDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockMarkJobReady.mockResolvedValue(true)
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockDeletePageByIds.mockImplementation((_t, _w, ids: string[]) => Promise.resolve(ids.length))
    mockBuildFilterClause.mockReturnValue({})
  })

  it('deletes every matching page then marks the job ready', async () => {
    mockSelectRowIdPage
      .mockResolvedValueOnce(['a', 'b'])
      .mockResolvedValueOnce(['c'])
      .mockResolvedValueOnce([])

    await runTableDelete(basePayload({ filter: { status: 'old' } }))

    expect(mockDeletePageByIds).toHaveBeenNthCalledWith(1, 'tbl_1', 'ws_1', ['a', 'b'])
    expect(mockDeletePageByIds).toHaveBeenNthCalledWith(2, 'tbl_1', 'ws_1', ['c'])
    expect(mockMarkJobReady).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'delete', status: 'ready', progress: 3 })
    )
  })

  it('skips excluded rows but still advances the keyset cursor past them', async () => {
    mockSelectRowIdPage.mockResolvedValueOnce(['keep', 'x']).mockResolvedValueOnce([])

    await runTableDelete(basePayload({ excludeRowIds: ['keep'] }))

    expect(mockDeletePageByIds).toHaveBeenCalledTimes(1)
    expect(mockDeletePageByIds).toHaveBeenCalledWith('tbl_1', 'ws_1', ['x'])
    // Second page is queried after the last id of the first page (cursor advanced past 'keep').
    expect(mockSelectRowIdPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ afterId: 'x' })
    )
    expect(mockMarkJobReady).toHaveBeenCalled()
  })

  it('stops without marking ready when the ownership gate is lost (cancel/supersede)', async () => {
    mockSelectRowIdPage.mockResolvedValue(['a', 'b'])
    mockUpdateJobProgress.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await runTableDelete(basePayload())

    expect(mockDeletePageByIds).toHaveBeenCalledTimes(1)
    expect(mockMarkJobReady).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' })
    )
  })

  it('marks the job failed and emits a failed event on error', async () => {
    mockSelectRowIdPage.mockRejectedValue(new Error('boom'))

    await runTableDelete(basePayload())

    expect(mockMarkJobFailed).toHaveBeenCalledWith('tbl_1', 'job_1', 'boom')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'delete', status: 'failed', error: 'boom' })
    )
  })

  it('passes the cutoff and filter clause through to the page query', async () => {
    mockSelectRowIdPage.mockResolvedValueOnce([])

    await runTableDelete(basePayload({ filter: { status: 'old' } }))

    expect(mockBuildFilterClause).toHaveBeenCalledWith(
      { status: 'old' },
      'user_table_rows',
      table.schema.columns
    )
    expect(mockSelectRowIdPage).toHaveBeenCalledWith(
      expect.objectContaining({ cutoff, filterClause: {}, limit: 2 })
    )
  })
})
