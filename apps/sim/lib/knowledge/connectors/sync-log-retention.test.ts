/**
 * @vitest-environment node
 */
import { knowledgeConnectorSyncLog } from '@sim/db/schema'
import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: () => null }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))

import { GET } from '@/app/api/cron/cleanup-stale-executions/route'

/** Flattens a drizzle condition tree into the values it compares against. */
function collectValues(value: unknown, out: unknown[] = []): unknown[] {
  if (!value || typeof value !== 'object') return out
  const record = value as Record<string, unknown>
  if ('right' in record) out.push(record.right)
  if ('value' in record) out.push(record.value)
  // `inArray` keeps its comparands under `values`, not `right`.
  if (Array.isArray(record.values)) out.push(...record.values)
  // Column references, so a predicate can be identified by what it filters on.
  if (typeof record.column === 'string') out.push(record.column)
  if (typeof record.left === 'string') out.push(record.left)
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) for (const item of nested) collectValues(item, out)
    else collectValues(nested, out)
  }
  return out
}

/**
 * The retention arm's claim predicate.
 *
 * Identified by the column it filters on, not by the statuses it admits: the
 * async-job retention arm in the same handler compares against `completed` and
 * `failed` too, so matching on those alone silently asserts against the wrong
 * predicate.
 */
function syncLogClaimPredicate(): unknown[] | undefined {
  return dbChainMockFns.where.mock.calls
    .map(([condition]) => collectValues(condition))
    .find(
      (values) =>
        // All three, because `where` also fires for the arm's own `exists`
        // subqueries — one of which filters this same column against
        // `completed` — and the async-job arm compares `completed`/`failed` on a
        // different table. Only the outer claim has every discriminator.
        values.includes(schemaMock.knowledgeConnectorSyncLog.status) &&
        values.includes('completed') &&
        values.includes('failed')
    )
}

describe('connector sync log retention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(knowledgeConnectorSyncLog, [{ id: 'kcsl-1' }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'kcsl-1' }])
  })

  /**
   * `loadPreviousListingObservation` reconstructs the previous listing from a
   * connector's latest `completed` log, and that reconstruction decides whether
   * a suspect listing is corroborated — i.e. whether reconciliation may delete
   * documents. Pruning the last `completed` row would silently change deletion
   * behaviour, so the two `exists` guards are load-bearing.
   */
  it('claims only terminal rows that still have a newer sibling', async () => {
    await GET(createMockRequest('GET') as never)

    const predicate = syncLogClaimPredicate()
    // The arm has to actually run, or this asserts nothing.
    expect(predicate).toBeDefined()

    /** `started` is in flight, or waiting on the scheduler's own sweep. */
    expect(predicate).not.toContain('started')
  })

  it('reports what it pruned', async () => {
    const response = await GET(createMockRequest('GET') as never)
    const body = (await response.json()) as {
      connectorSyncLogs?: { pruned: number; retentionDays: number }
    }

    expect(body.connectorSyncLogs?.retentionDays).toBe(30)
    expect(body.connectorSyncLogs?.pruned).toBeGreaterThan(0)
  })
})
