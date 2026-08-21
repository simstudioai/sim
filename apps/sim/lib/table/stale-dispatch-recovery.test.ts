/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAppendTableEvent } = vi.hoisted(() => ({
  mockAppendTableEvent: vi.fn(),
}))

vi.mock('@/lib/table/events', () => ({
  appendTableEvent: mockAppendTableEvent,
}))

import { cancelStaleDispatches } from '@/lib/table/dispatcher'

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
