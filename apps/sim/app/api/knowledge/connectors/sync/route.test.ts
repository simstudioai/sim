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
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
  connectorFailureBackoffMinutes,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'

const { mockVerifyCronAuth, mockDispatchSync, mockResolveSystemBillingAttribution } = vi.hoisted(
  () => ({
    mockVerifyCronAuth: vi.fn().mockReturnValue(null),
    mockDispatchSync: vi.fn().mockResolvedValue(undefined),
    mockResolveSystemBillingAttribution: vi.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
  })
)

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/knowledge/connectors/queue', () => ({ dispatchSync: mockDispatchSync }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
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

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockVerifyCronAuth.mockReturnValue(null)
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

  it('does not stamp lastSyncAt when reclaiming a stale lock', async () => {
    await runTickRecovering(['connector-1'])

    expect(setPayloadForUpdate(0)).not.toHaveProperty('lastSyncAt')
  })

  it('closes orphaned sync-log rows still marked started', async () => {
    await runTickRecovering(['connector-1', 'connector-2'])

    expect(dbChainMockFns.update.mock.calls[1][0]).toBe(schemaMock.knowledgeConnectorSyncLog)

    const payload = setPayloadForUpdate(1)
    expect(payload.status).toBe('failed')
    expect(renderedSql(payload.completedAt)).toContain('now()')
    expect(payload.errorMessage).toEqual(expect.any(String))

    const where = dbChainMockFns.where.mock.calls[1][0]
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

  it('spares the log row of a run that still holds its connector lock', async () => {
    await runTickRecovering(['connector-1'])

    /**
     * The sweep keys on `startedAt`, which no heartbeat refreshes, so age alone
     * would close a legitimately long in-process run's row and record a
     * successful sync as failed.
     */
    const where = dbChainMockFns.where.mock.calls[1][0]
    const liveness = flattenMockConditions(where).find(
      (node: MockCondition) => typeof node.toSQL === 'function'
    )
    expect(liveness).toBeDefined()

    const rendered = (liveness as unknown as MockSqlFragment).toSQL().sql
    expect(rendered).toContain('NOT EXISTS')
    expect(rendered).toContain("'syncing'")

    const bound = (liveness as unknown as MockSqlFragment).values
    expect(bound).toContain(schemaMock.knowledgeConnector.syncLockToken)
    expect(bound).toContain(schemaMock.knowledgeConnectorSyncLog.id)
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

    const logUpdateIndex = dbChainMockFns.update.mock.calls.findIndex(
      (call) => call[0] === schemaMock.knowledgeConnectorSyncLog
    )
    expect(logUpdateIndex).toBeGreaterThanOrEqual(0)
    expect(setPayloadForUpdate(logUpdateIndex).status).toBe('failed')
  })

  it('never scopes the sync-log sweep to a connector id', async () => {
    await runTickRecovering(['connector-1'])

    const where = dbChainMockFns.where.mock.calls[1][0]

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
