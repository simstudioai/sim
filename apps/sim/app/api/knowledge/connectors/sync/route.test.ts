/**
 * Tests for the connector sync scheduler's stale-lock reaper.
 *
 * A hard kill (OOM/SIGKILL) skips `executeSync`'s `catch` and `finally`, so this
 * reaper is the only writer that ever records that failure. These tests pin the
 * shape of the SQL it writes, which is the part no shape-agnostic mock can enforce.
 *
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { type NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  connectorFailureBackoffMinutes,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'

const {
  mockVerifyCronAuth,
  mockDispatchSync,
  mockResolveSystemBillingAttribution,
  mockResolveSystemOrganizationBillingAttribution,
} = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockDispatchSync: vi.fn().mockResolvedValue(undefined),
  mockResolveSystemBillingAttribution: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
  mockResolveSystemOrganizationBillingAttribution: vi
    .fn()
    .mockResolvedValue({ workspaceId: null, organizationId: 'org-1' }),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/knowledge/connectors/queue', () => ({ dispatchSync: mockDispatchSync }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
  resolveSystemOrganizationBillingAttribution: mockResolveSystemOrganizationBillingAttribution,
}))

import { GET } from '@/app/api/knowledge/connectors/sync/route'

/** A drizzle `sql` fragment as the shared test mock renders it. */
interface MockSqlFragment {
  values: unknown[]
  toSQL: () => { sql: string; params: unknown[] }
}

function isSqlFragment(value: unknown): value is MockSqlFragment {
  return typeof value === 'object' && value !== null && 'toSQL' in value && 'values' in value
}

function asFragment(value: unknown): MockSqlFragment {
  expect(isSqlFragment(value)).toBe(true)
  return value as MockSqlFragment
}

function renderedSql(value: unknown): string {
  return asFragment(value).toSQL().sql
}

function numericBinds(value: unknown): number[] {
  return asFragment(value).values.filter((v): v is number => typeof v === 'number')
}

/**
 * Asserts one operand is the lock-lease expression rather than a bare column.
 *
 * `sync_lock_lease_at` is written only by lock acquisition and the heartbeat, so
 * it is the lease; `updated_at` moves on every unrelated write and merely used
 * to double as one. It is read through COALESCE rather than backfilled: a plain
 * `lease <= cutoff` is NULL-false, so a row already `syncing` when the column
 * shipped would never be reclaimed at all.
 */
function expectLeaseExpression(value: unknown): void {
  const fragment = asFragment(value)
  expect(fragment.toSQL().sql).toBe('COALESCE(?, ?)')
  expect(fragment.values[0]).toBe(schemaMock.knowledgeConnector.syncLockLeaseAt)
  expect(fragment.values[1]).toBe(schemaMock.knowledgeConnector.updatedAt)
}

function cronRequest(): NextRequest {
  return new Request('https://sim.ai/api/knowledge/connectors/sync', {
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as unknown as NextRequest
}

/** Runs one scheduler tick that reclaims the given stale connector ids. */
async function runTickRecovering(ids: string[]) {
  dbChainMockFns.returning.mockResolvedValueOnce(ids.map((id) => ({ id })))
  const response = await GET(cronRequest())
  expect(response.status).toBe(200)
}

/** The `.set()` payload of the nth `db.update()` chain in call order. */
function setPayloadForUpdate(index: number): Record<string, unknown> {
  return dbChainMockFns.set.mock.calls[index][0] as Record<string, unknown>
}

/** Fixed so the reclaim cutoff can be compared by value, not merely by type. */
const NOW = new Date('2026-08-20T12:00:00.000Z')
const EXPECTED_STALE_CUTOFF = new Date(NOW.getTime() - CONNECTOR_SYNC_STALE_LOCK_TTL_MS)

/** The `.where()` condition of the nth `db.update()` chain in call order. */
function whereForUpdate(index: number): unknown {
  return dbChainMockFns.where.mock.calls[index][0]
}

/**
 * Position of the update targeting a given table, resolved by table rather than
 * hardcoded: the tick runs several updates and a new one inserted between them
 * would otherwise silently re-point every later assertion at the wrong chain.
 */
function updateIndexFor(table: unknown): number {
  const index = dbChainMockFns.update.mock.calls.findIndex((call) => call[0] === table)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

/** The sync-log sweep's `.where()` condition, whichever chain it ran as. */
function syncLogSweepWhere(): unknown {
  return whereForUpdate(updateIndexFor(schemaMock.knowledgeConnectorSyncLog))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockVerifyCronAuth.mockReturnValue(null)
  mockDispatchSync.mockResolvedValue(undefined)
  mockResolveSystemBillingAttribution.mockResolvedValue({ workspaceId: 'ws-1' })
  mockResolveSystemOrganizationBillingAttribution.mockResolvedValue({
    workspaceId: null,
    organizationId: 'org-1',
  })
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('connector sync scheduler stale-lock reaper', () => {
  it('increments consecutiveFailures in the same statement that flips the lock', async () => {
    await runTickRecovering(['connector-1'])

    expect(dbChainMockFns.update.mock.calls[0][0]).toBe(schemaMock.knowledgeConnector)

    const payload = setPayloadForUpdate(0)
    expect(payload.consecutiveFailures).toBeDefined()
    expect(typeof payload.consecutiveFailures).not.toBe('number')

    const rendered = renderedSql(payload.consecutiveFailures)
    expect(rendered).toContain('COALESCE(')
    expect(rendered).toContain(', 0) + 1')
    expect(asFragment(payload.consecutiveFailures).values).toContain(
      schemaMock.knowledgeConnector.consecutiveFailures
    )
  })

  it('disables at the threshold and errors below it', async () => {
    await runTickRecovering(['connector-1'])

    const status = setPayloadForUpdate(0).status

    /**
     * Asserted whole rather than by its bookends: the comparison is the entire
     * point of this expression, and leaving it in an un-asserted middle let
     * `+ 2 >=`, `+ 1 >`, and an inverted `+ 1 <=` all pass. The last of those
     * disables a connector on its first hard kill.
     */
    expect(renderedSql(status)).toBe(
      "CASE WHEN COALESCE(?, 0) + 1 >= ? THEN 'disabled' ELSE 'error' END"
    )
    expect(asFragment(status).values[0]).toBe(schemaMock.knowledgeConnector.consecutiveFailures)
    expect(asFragment(status).values[1]).toBe(MAX_CONSECUTIVE_FAILURES)
  })

  it('derives nextSyncAt from the shared failure backoff ladder', async () => {
    await runTickRecovering(['connector-1'])

    const nextSyncAt = setPayloadForUpdate(0).nextSyncAt
    const rendered = renderedSql(nextSyncAt)

    expect(rendered).toBe(
      'CASE WHEN COALESCE(?, 0) + 1 >= ? THEN NULL ' +
        "ELSE now() + LEAST((COALESCE(?, 0) + 1) * ?, ?) * INTERVAL '1 minute' END"
    )

    const [threshold, step, cap] = numericBinds(nextSyncAt)
    expect(threshold).toBe(MAX_CONSECUTIVE_FAILURES)
    expect(step).toBe(CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES)
    expect(cap).toBe(CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES)

    /**
     * Pinned to literals, not recomputed from the binds. Comparing
     * `Math.min(failures * step, cap)` against `connectorFailureBackoffMinutes`
     * derived both sides from the same two constants, so it held for any values
     * AND any shape — swapping the SQL's `*` for `+` left every substring and
     * every bind untouched. The shape is pinned by the string assertion above;
     * these pin the magnitudes independently of both the SQL and the helper.
     */
    expect(step).toBe(30)
    expect(cap).toBe(1440)
  })

  it('applies the same minutes in SQL that the shared helper computes in JS', async () => {
    /**
     * The equivalence the ladder test above only appeared to establish. The SQL
     * encodes `LEAST((failures) * 30, 1440)`; these fix what the JS helper
     * returns for the same inputs, so the two cannot drift without one of the
     * two assertions failing.
     */
    expect(connectorFailureBackoffMinutes(1)).toBe(30)
    expect(connectorFailureBackoffMinutes(2)).toBe(60)
    expect(connectorFailureBackoffMinutes(3)).toBe(90)
    expect(connectorFailureBackoffMinutes(9)).toBe(270)
    // 48 * 30 is exactly the cap; either side of it must clamp, not overshoot.
    expect(connectorFailureBackoffMinutes(47)).toBe(1410)
    expect(connectorFailureBackoffMinutes(48)).toBe(1440)
    expect(connectorFailureBackoffMinutes(49)).toBe(1440)
    expect(connectorFailureBackoffMinutes(100)).toBe(1440)
  })

  it('releases the reclaimed run ownership token', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * Without this the reclaimed run's token still matches its own terminal
     * write, so it can overwrite the verdict this reclaim just recorded.
     */
    expect(setPayloadForUpdate(0).syncLockToken).toBeNull()
  })

  it('closes the reclaimed run lease alongside its token', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * A reclaimed row is re-locked by its replacement, which opens a fresh
     * lease. Leaving the dead run's lease behind would let the replacement
     * inherit an already-expired one and be reclaimed on the very next tick.
     */
    expect(setPayloadForUpdate(0).syncLockLeaseAt).toBeNull()
  })

  it('tells the operator the connector is disabled when the reclaim disables it', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * `reclaimedStatus()` disables at the threshold and `reclaimedNextSyncAt()`
     * then writes no next attempt, so an unconditional "timed out, will retry"
     * message describes a retry that will never happen. The two CASE arms must
     * pivot on the same comparison.
     */
    const error = setPayloadForUpdate(0).lastSyncError
    expect(renderedSql(error)).toBe('CASE WHEN COALESCE(?, 0) + 1 >= ? THEN ? ELSE ? END')

    const values = asFragment(error).values
    expect(values[0]).toBe(schemaMock.knowledgeConnector.consecutiveFailures)
    expect(values[1]).toBe(MAX_CONSECUTIVE_FAILURES)
    // Sourced from the constant the in-process breaker writes, so the two
    // writers of one verdict cannot drift into two different messages.
    expect(values[2]).toBe(CONNECTOR_AUTO_DISABLED_ERROR)
    expect(values[3]).toBe('Sync timed out (stale lock recovered)')
  })

  it('does not stamp lastSyncAt when reclaiming a stale lock', async () => {
    await runTickRecovering(['connector-1'])

    expect(setPayloadForUpdate(0)).not.toHaveProperty('lastSyncAt')
  })

  it('closes orphaned sync-log rows still marked started', async () => {
    await runTickRecovering(['connector-1', 'connector-2'])

    const logUpdateIndex = updateIndexFor(schemaMock.knowledgeConnectorSyncLog)

    const payload = setPayloadForUpdate(logUpdateIndex)
    expect(payload.status).toBe('failed')
    expect(renderedSql(payload.completedAt)).toContain('now()')
    expect(payload.errorMessage).toBe('Sync timed out (stale lock recovered)')

    const where = syncLogSweepWhere()
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnectorSyncLog.status &&
          node.right === 'started'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'lte' && node.left === schemaMock.knowledgeConnectorSyncLog.startedAt
      )
    ).toBe(true)
  })

  /** The `NOT EXISTS` liveness fragment the sweep's WHERE carries. */
  function sweepLivenessFragment(): MockSqlFragment {
    const where = syncLogSweepWhere()
    const fragment = flattenMockConditions(where).find(
      (node: MockCondition) => typeof node.toSQL === 'function'
    )
    expect(fragment).toBeDefined()
    return fragment as unknown as MockSqlFragment
  }

  it('spares the log row of a run whose lock is still being heartbeated', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * The sweep keys on `startedAt`, which no heartbeat refreshes, so age alone
     * would close a legitimately long in-process run's row and record a
     * successful sync as failed. Every clause is pinned: sparing requires the
     * connector to be locked, THIS row's run to be the holder, and that lock to
     * be live — an orphan can satisfy at most two.
     */
    const fragment = sweepLivenessFragment()

    expect(fragment.toSQL().sql.replace(/\s+/g, ' ').trim()).toBe(
      "NOT EXISTS ( SELECT 1 FROM ? WHERE ? = ? AND ? = ? AND ? = 'syncing' AND ? > ? )"
    )

    /**
     * The rendered SQL above is seven `?` carrying every operand, so the shape
     * assertion alone cannot tell one column from another. The bound values are
     * the only place the predicate's operands are observable, and they are
     * checked positionally so a swapped column fails on the exact slot.
     */
    const bound = fragment.values
    expect(bound[0]).toBe(schemaMock.knowledgeConnector)
    expect(bound[1]).toBe(schemaMock.knowledgeConnector.id)
    expect(bound[2]).toBe(schemaMock.knowledgeConnectorSyncLog.connectorId)
    expect(bound[3]).toBe(schemaMock.knowledgeConnector.syncLockToken)
    expect(bound[4]).toBe(schemaMock.knowledgeConnectorSyncLog.id)
    expect(bound[5]).toBe(schemaMock.knowledgeConnector.status)
    expectLeaseExpression(bound[6])
  })

  it('identifies the lock holder by token, not merely by the connector syncing', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * Without the token clause the sweep spares every `started` row on a locked
     * connector — including an orphan from a crashed run whose replacement now
     * holds the lock, which would then never drain while that connector stays
     * busy.
     */
    const bound = sweepLivenessFragment().values

    // Compared against the LOG ROW's id: matching the connector id instead makes
    // the correlation trivially true, so `NOT EXISTS` never spares anything.
    expect(bound[3]).toBe(schemaMock.knowledgeConnector.syncLockToken)
    expect(bound[4]).toBe(schemaMock.knowledgeConnectorSyncLog.id)
    expect(bound[4]).not.toBe(schemaMock.knowledgeConnectorSyncLog.connectorId)
  })

  it('requires the held lock to be heartbeated, not merely held', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * Without the freshness clause a run that died without being reclaimed — or
     * one on an archived or deleted connector, which the reclaim skips entirely
     * — keeps `status = 'syncing'` and its token forever, so its row is spared
     * forever.
     */
    const bound = sweepLivenessFragment().values
    expectLeaseExpression(bound[6])

    // Compared by value: `toBeDefined()` passed even for `new Date()`, which
    // spares nothing and closes rows started a second ago.
    expect((bound[7] as { value: Date }).value).toEqual(EXPECTED_STALE_CUTOFF)
  })

  it('closes stale sync-log rows even when no connector was reclaimed this tick', async () => {
    /**
     * The self-healing assertion. A row orphaned before this sweep existed —
     * or by a transient failure of the sweep itself — belongs to a connector
     * already flipped out of `syncing`, so it can never appear in a reclaim
     * batch again. Scoping the close to this tick's reclaims strands it forever.
     */
    const response = await GET(cronRequest())

    expect(response.status).toBe(200)

    expect(setPayloadForUpdate(updateIndexFor(schemaMock.knowledgeConnectorSyncLog)).status).toBe(
      'failed'
    )
  })

  it('recovers connectors whose queued sync was never started', async () => {
    await runTickRecovering(['connector-1'])

    /** Located by its `status = 'pending'` predicate, not by position in the tick. */
    const pendingIndex = dbChainMockFns.update.mock.calls.findIndex((call, index) => {
      if (call[0] !== schemaMock.knowledgeConnector) return false
      return hasMockCondition(
        whereForUpdate(index),
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.status &&
          node.right === 'pending'
      )
    })
    expect(pendingIndex).toBeGreaterThanOrEqual(0)

    /**
     * Ages against the lease, not `updatedAt`: a pending connector is still
     * editable, and `updatedAt` moves on every unrelated write, so using it
     * would let a config edit defer the recovery indefinitely — the bug the
     * lease column was introduced to close for `syncing`.
     */
    const pendingCutoff = flattenMockConditions(whereForUpdate(pendingIndex)).find(
      (node: MockCondition) => typeof node.toSQL === 'function'
    ) as unknown as MockSqlFragment | undefined
    expect(pendingCutoff?.toSQL().sql).toBe('? <= ?')
    expectLeaseExpression(pendingCutoff?.values[0])
    expect((pendingCutoff?.values[1] as { value: Date }).value).toEqual(EXPECTED_STALE_CUTOFF)

    /** Re-enters the shared failure ladder rather than re-queueing every tick. */
    const payload = setPayloadForUpdate(pendingIndex)
    expect(renderedSql(payload.status)).toContain('disabled')
    expect(renderedSql(payload.consecutiveFailures)).toBe('COALESCE(?, 0) + 1')

    /**
     * Reports a lost hand-off, not a timeout: nothing ran, so the stale-lock
     * wording would describe a run that never existed.
     */
    expect(asFragment(payload.lastSyncError).values).toContain('Sync was queued but never started')
  })

  it('never scopes the sync-log sweep to a connector id', async () => {
    await runTickRecovering(['connector-1'])

    const where = syncLogSweepWhere()

    /**
     * Checks every position, not just `column`. `eq()` builds `{left, right}`
     * and only `inArray()` builds `{column}`, so a `column`-only assertion
     * silently permitted an `eq`-scoped sweep — the exact coupling this test
     * exists to forbid.
     */
    const connectorIdColumn = schemaMock.knowledgeConnectorSyncLog.connectorId
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.column === connectorIdColumn ||
          node.left === connectorIdColumn ||
          node.right === connectorIdColumn
      )
    ).toBe(false)

    // And positively: the sweep is keyed on the row's own age.
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'lte' && node.left === schemaMock.knowledgeConnectorSyncLog.startedAt
      )
    ).toBe(true)
  })

  it('drives the connector write off a single clock', async () => {
    await runTickRecovering(['connector-1'])

    // `updatedAt` shares the server clock the nextSyncAt interval math uses.
    expect(renderedSql(setPayloadForUpdate(0).updatedAt)).toContain('now()')
  })
})

describe('connector sync scheduler reclaim predicate', () => {
  it('reclaims only connectors that are syncing and past the stale cutoff', async () => {
    await runTickRecovering(['connector-1'])

    const where = whereForUpdate(0)

    /**
     * Asserted against the CONNECTOR's own columns. While every mock column was
     * its bare name, `knowledgeConnector.status` and
     * `knowledgeConnectorSyncLog.status` were both `'status'`, so this passed
     * for a predicate guarding the wrong table entirely.
     */
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.status &&
          node.right === 'syncing'
      )
    ).toBe(true)

    // Deleting this clause reclaims every syncing connector on every tick.
    const cutoff = flattenMockConditions(where).find(
      (node: MockCondition) => typeof node.toSQL === 'function'
    ) as unknown as MockSqlFragment | undefined
    expect(cutoff).toBeDefined()
    expect(cutoff?.toSQL().sql).toBe('? <= ?')
    expectLeaseExpression(cutoff?.values[0])
    expect((cutoff?.values[1] as { value: Date }).value).toEqual(EXPECTED_STALE_CUTOFF)

    for (const column of [
      schemaMock.knowledgeConnector.archivedAt,
      schemaMock.knowledgeConnector.deletedAt,
    ]) {
      expect(
        hasMockCondition(
          where,
          (node: MockCondition) => node.type === 'isNull' && node.column === column
        )
      ).toBe(true)
    }
  })
})

describe('connector sync scheduler authentication and dispatch', () => {
  it('rejects an unauthenticated request without touching the database', async () => {
    mockVerifyCronAuth.mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const response = await GET(cronRequest())

    // Deleting the auth check leaves an unauthenticated cron endpoint.
    expect(response.status).toBe(401)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('dispatches a sync for every due connector with its workspace billing context', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'due-1', workspaceId: 'ws-1' },
      { id: 'due-2', workspaceId: 'ws-2' },
    ])

    const response = await GET(cronRequest())

    // Deleting the dispatch call means no connector ever syncs.
    expect(await response.json()).toMatchObject({ success: true, count: 2 })
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('ws-1')
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('ws-2')
    expect(mockDispatchSync).toHaveBeenCalledTimes(2)
    expect(mockDispatchSync).toHaveBeenCalledWith(
      'due-1',
      expect.objectContaining({ billingAttribution: { workspaceId: 'ws-1' } })
    )
  })

  it('skips a connector missing resource billing context without failing the tick', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'due-1', workspaceId: null },
      { id: 'due-2', workspaceId: 'ws-2' },
    ])

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    expect(mockDispatchSync).toHaveBeenCalledTimes(1)
    expect(mockDispatchSync).toHaveBeenCalledWith('due-2', expect.anything())
  })

  it('dispatches org sources with their canonical organization payer', async () => {
    const nextSyncAt = new Date('2026-09-01T00:00:00Z')
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'org-source', workspaceId: null, organizationId: 'org-1', nextSyncAt },
    ])
    await GET(cronRequest())
    expect(dbChainMockFns.select).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: schemaMock.knowledgeBase.workspaceId,
        organizationId: schemaMock.knowledgeBase.organizationId,
      })
    )
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockResolveSystemOrganizationBillingAttribution).toHaveBeenCalledExactlyOnceWith('org-1')
    expect(mockDispatchSync).toHaveBeenCalledExactlyOnceWith('org-source', {
      billingAttribution: { workspaceId: null, organizationId: 'org-1' },
      expectedNextSyncAt: nextSyncAt,
      requestId: expect.any(String),
      requireRunnable: true,
    })
  })

  it('does not infer a payer for ambiguous ownership or failed org billing', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'ambiguous', workspaceId: 'ws-1', organizationId: 'org-1' },
      { id: 'org-source', workspaceId: null, organizationId: 'org-1' },
    ])
    mockResolveSystemOrganizationBillingAttribution.mockRejectedValue(
      new Error('Owner unavailable')
    )
    await GET(cronRequest())
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockResolveSystemOrganizationBillingAttribution).toHaveBeenCalledExactlyOnceWith('org-1')
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('reports a tick with nothing due', async () => {
    const response = await GET(cronRequest())

    expect(await response.json()).toMatchObject({ success: true, count: 0 })
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })
})
