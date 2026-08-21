/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAppendTableEvent, mockGetTableById } = vi.hoisted(() => ({
  mockAppendTableEvent: vi.fn(),
  mockGetTableById: vi.fn(),
}))

vi.mock('@/lib/table/events', () => ({
  appendTableEvent: mockAppendTableEvent,
}))
vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))

import { cancelStaleDispatches, dispatcherStep } from '@/lib/table/dispatcher'

const STALE_BEFORE = new Date('2026-08-21T17:00:00.000Z')

const ABANDONED_ROW = {
  id: 'tdsp_1',
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  requestId: 'req-1',
  mode: 'incomplete',
  scope: { groupIds: ['group-1'] },
  status: 'dispatching',
  cursor: 42,
  limit: null,
  processedCount: 7,
  isManualRun: true,
  triggeredByUserId: 'user-1',
  requestedAt: new Date('2026-08-21T15:00:00.000Z'),
}

/**
 * Flattens a drizzle condition tree into the pieces a raw `sql` fragment is
 * built from. The mock renders columns as `?` placeholders, so the rendered
 * string cannot show which columns a fragment reads — the chunks can, because
 * the schema mock represents each column as its own `table.column` string.
 */
function collectChunks(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== 'object') return out
  if (typeof value === 'string') return out
  const record = value as Record<string, unknown>
  for (const [key, nested] of Object.entries(record)) {
    if (typeof nested === 'string') {
      if (key !== 'brand') out.push(nested)
    } else if (Array.isArray(nested)) {
      for (const item of nested) {
        if (typeof item === 'string') out.push(item)
        else collectChunks(item, out)
      }
    } else {
      collectChunks(nested, out)
    }
  }
  return out
}

describe('cancelStaleDispatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The bounded claim select, then the guarded update it feeds.
    dbChainMockFns.limit.mockResolvedValue([{ id: ABANDONED_ROW.id }])
    dbChainMockFns.returning.mockResolvedValue([ABANDONED_ROW])
  })

  it('cancels an abandoned dispatch rather than completing it', async () => {
    const cancelled = await cancelStaleDispatches(STALE_BEFORE, 200)

    const values = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
    /**
     * Cancelled, not complete: the dispatch never finished its scope, and
     * reporting completion would claim work happened that did not.
     */
    expect(values.status).toBe('cancelled')
    expect(values.cancelledAt).toBeInstanceOf(Date)
    // The cursor is untouched, so a re-run resumes instead of replaying.
    expect(values).not.toHaveProperty('cursor')
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0].status).toBe('cancelled')
  })

  it('ages from the heartbeat, falling back to requestedAt when it is null', async () => {
    await cancelStaleDispatches(STALE_BEFORE, 200)

    const chunks = collectChunks(dbChainMockFns.where.mock.calls[0][0])
    /**
     * `heartbeat_at` alone would be NULL-false for every row written before the
     * column existed, leaving exactly the wedged dispatches this sweep exists to
     * clear permanently unreclaimable.
     */
    expect(chunks.some((chunk) => chunk.includes('COALESCE('))).toBe(true)
    expect(chunks).toContain('tableRunDispatches.heartbeatAt')
    expect(chunks).toContain('tableRunDispatches.requestedAt')
  })

  it('spares a dispatch whose cells are still reporting', async () => {
    await cancelStaleDispatches(STALE_BEFORE, 200)

    /**
     * Matched on the literal SQL, not on column references: the fragment
     * interpolates the `tableRowExecutions` table object, so every one of its
     * column names appears in the chunks whether the predicate uses it or not —
     * asserting on those passes even with the predicate deleted.
     */
    const joined = collectChunks(dbChainMockFns.where.mock.calls[0][0]).join(' ')

    /**
     * The dispatch's own heartbeat is stamped between windows, not during them,
     * and the loop is checkpointed for the whole window — so a long window
     * leaves it untouched while the dispatch is plainly alive. Its cells carry
     * the signal the checkpointed parent cannot, and both have to be stale
     * before the row is reclaimed.
     */
    expect(joined).toContain('NOT ')
    expect(joined).toContain('EXISTS (')

    /**
     * Scoped to the dispatch's own groups AND its rows. Auto-fired and
     * row-scoped runs do NOT cancel overlapping dispatches, so a live dispatch
     * sharing a table is ordinary — without both filters its cells vouch for an
     * abandoned neighbour and the abandoned row is never reclaimed.
     */
    expect(joined).toContain("-> 'groupIds'")
    expect(joined).toContain("-> 'rowIds'")
  })

  it('emits the terminal event so a stuck client overlay clears', async () => {
    await cancelStaleDispatches(STALE_BEFORE, 200)

    /**
     * Without this the row goes terminal in the database while the "X running"
     * overlay stays pinned — the exact symptom the sweep is meant to fix.
     */
    expect(mockAppendTableEvent).toHaveBeenCalledTimes(1)
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dispatch',
        dispatchId: 'tdsp_1',
        tableId: 'table-1',
        status: 'cancelled',
        cursor: 42,
      })
    )
  })

  it('bounds how many dispatches one sweep reclaims', async () => {
    await cancelStaleDispatches(STALE_BEFORE, 200)

    // One tick must not fan out unbounded SSE, however deep the backlog is.
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(200)
  })

  it('emits nothing when no dispatch is stale', async () => {
    dbChainMockFns.limit.mockResolvedValue([])

    const cancelled = await cancelStaleDispatches(STALE_BEFORE, 200)

    expect(cancelled).toEqual([])
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })
})

describe('dispatcherStep pending transition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The step reads the dispatch, then awaits the table load before writing
   * `dispatching`. A cancel landing in that window — a Stop-all, or the
   * stale-dispatch sweep — must win: keying the write on the id alone
   * resurrected the row, and with a fresh heartbeat the sweep would then wait
   * out another full window before reclaiming what it had already given up on.
   */
  it('stops the step when the claim loses the race', async () => {
    mockGetTableById.mockResolvedValue({
      id: 'table-1',
      schema: { workflowGroups: [{ id: 'group-1' }] },
    })
    dbChainMockFns.limit.mockResolvedValue([{ ...ABANDONED_ROW, status: 'pending' }])
    // The guarded claim matched nothing — a Stop-all or the sweep got there first.
    dbChainMockFns.returning.mockResolvedValue([])

    const result = await dispatcherStep('tdsp_1')

    /**
     * Guarding the write without reading its outcome is the worse half of a fix:
     * the row correctly stays cancelled while the step announces `dispatching`,
     * stamps cells and enqueues a window for it.
     */
    expect(result).toBe('done')
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('re-asserts the status it read before claiming the dispatch', async () => {
    mockGetTableById.mockResolvedValue({
      id: 'table-1',
      schema: { workflowGroups: [{ id: 'group-1' }] },
    })
    dbChainMockFns.limit.mockResolvedValue([{ ...ABANDONED_ROW, status: 'pending' }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'tdsp_1' }])

    await dispatcherStep('tdsp_1').catch(() => {})

    // The write must actually happen, or this asserts nothing.
    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) => (call[0] as Record<string, unknown> | undefined)?.status === 'dispatching'
      )
    ).toBe(true)

    /**
     * `set` and `where` are separate spies, so their call indexes do not pair —
     * `readDispatch`'s own select filed a `where` first. Match on the predicate
     * that only the claim can produce: this row's id AND its status together.
     */
    const claimPredicate = dbChainMockFns.where.mock.calls
      .map((call) => collectChunks(call[0]))
      .find(
        (chunks) =>
          chunks.includes('tableRunDispatches.id') && chunks.includes('tableRunDispatches.status')
      )
    expect(claimPredicate).toBeDefined()
  })
})
