/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetTableById,
  mockGetJobProgress,
  mockSelectRowIdPage,
  mockDeletePageByIds,
  mockUpdateJobProgress,
  mockMarkJobReady,
  mockMarkJobFailed,
  mockAppendTableEvent,
  mockBuildFilterClause,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockGetJobProgress: vi.fn(),
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
}))
vi.mock('@/lib/table/jobs/service', () => ({
  getJobProgress: mockGetJobProgress,
  updateJobProgress: mockUpdateJobProgress,
  markJobReady: mockMarkJobReady,
  markJobFailed: mockMarkJobFailed,
}))
vi.mock('@/lib/table/rows/ordering', () => ({
  selectRowIdPage: mockSelectRowIdPage,
  deletePageByIds: mockDeletePageByIds,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/lib/table/sql', () => ({ buildFilterClause: mockBuildFilterClause }))
vi.mock('@/lib/table/constants', () => ({
  TABLE_LIMITS: { DELETE_PAGE_SIZE: 2 },
  USER_TABLE_ROWS_SQL_NAME: 'user_table_rows',
}))

import { markTableDeleteFailed, runTableDelete } from '@/lib/table/delete-runner'

const table = { id: 'tbl_1', workspaceId: 'ws_1', schema: { columns: [] } }
const cutoff = new Date('2026-06-05T00:00:00Z')

function basePayload(overrides = {}) {
  return { jobId: 'job_1', tableId: 'tbl_1', workspaceId: 'ws_1', cutoff, ...overrides }
}

describe('runTableDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockGetJobProgress.mockResolvedValue(0)
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

  it('stops once maxRows is reached and caps the final page fetch to the remaining budget', async () => {
    // budget 3 with page size 2: first page fills 2, the second is capped to the remaining 1.
    mockSelectRowIdPage.mockResolvedValueOnce(['a', 'b']).mockResolvedValueOnce(['c'])

    await runTableDelete(basePayload({ filter: { status: 'old' }, maxRows: 3 }))

    expect(mockSelectRowIdPage).toHaveBeenCalledTimes(2)
    expect(mockSelectRowIdPage.mock.calls[0][0]).toMatchObject({ limit: 2 })
    expect(mockSelectRowIdPage.mock.calls[1][0]).toMatchObject({ limit: 1 })
    expect(mockDeletePageByIds).toHaveBeenCalledTimes(2)
    expect(mockMarkJobReady).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', progress: 3 })
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

  it('rethrows unexpected errors without failing the job (caller retries decide)', async () => {
    mockSelectRowIdPage.mockRejectedValue(new Error('boom'))

    await expect(runTableDelete(basePayload())).rejects.toThrow('boom')

    expect(mockMarkJobFailed).not.toHaveBeenCalled()
    expect(mockAppendTableEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('returns quietly when superseded mid-run without failing the job', async () => {
    mockSelectRowIdPage.mockResolvedValue(['a', 'b'])
    mockUpdateJobProgress.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(runTableDelete(basePayload())).resolves.toBeUndefined()

    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('rethrows the root cause so the clean message survives serialization', async () => {
    const cause = new Error('canceling statement due to statement timeout')
    mockSelectRowIdPage.mockRejectedValue(new Error('Failed query: delete ...', { cause }))

    await expect(runTableDelete(basePayload())).rejects.toThrow(
      'canceling statement due to statement timeout'
    )
  })

  it('resumes cumulative progress on retry instead of resetting to zero', async () => {
    mockGetJobProgress.mockResolvedValue(7)
    mockSelectRowIdPage.mockResolvedValueOnce(['a', 'b']).mockResolvedValueOnce([])

    await runTableDelete(basePayload())

    expect(mockUpdateJobProgress).toHaveBeenNthCalledWith(1, 'tbl_1', 7, 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', progress: 9 })
    )
  })

  it('stops at the seed read when the job is no longer owned', async () => {
    mockGetJobProgress.mockResolvedValue(null)

    await expect(runTableDelete(basePayload())).resolves.toBeUndefined()

    expect(mockSelectRowIdPage).not.toHaveBeenCalled()
    expect(mockDeletePageByIds).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
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

describe('markTableDeleteFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkJobFailed.mockResolvedValue(undefined)
  })

  it('marks the job failed and emits the failed event', async () => {
    await markTableDeleteFailed('tbl_1', 'job_1', new Error('boom'))

    expect(mockMarkJobFailed).toHaveBeenCalledWith('tbl_1', 'job_1', 'boom')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'delete', status: 'failed', error: 'boom' })
    )
  })

  it('prefers the error cause over a verbose wrapper message', async () => {
    const cause = new Error('canceling statement due to statement timeout')
    const wrapper = new Error(`Failed query: delete from x where id in (${'$1,'.repeat(5000)})`, {
      cause,
    })

    await markTableDeleteFailed('tbl_1', 'job_1', wrapper)

    expect(mockMarkJobFailed).toHaveBeenCalledWith(
      'tbl_1',
      'job_1',
      'canceling statement due to statement timeout'
    )
  })

  it('truncates oversized messages', async () => {
    await markTableDeleteFailed('tbl_1', 'job_1', new Error('x'.repeat(2000)))

    const [, , message] = mockMarkJobFailed.mock.calls[0]
    expect(message).toHaveLength(503)
    expect(message.endsWith('...')).toBe(true)
  })
})
