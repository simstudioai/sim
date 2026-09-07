/**
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
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateIdempotencyKey,
  mockExecuteSync,
  mockIsTriggerAvailable,
  mockResolveTriggerRegion,
  mockTrigger,
} = vi.hoisted(() => ({
  mockCreateIdempotencyKey: vi.fn(),
  mockExecuteSync: vi.fn(),
  mockIsTriggerAvailable: vi.fn(),
  mockResolveTriggerRegion: vi.fn(),
  mockTrigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  idempotencyKeys: { create: mockCreateIdempotencyKey },
  tasks: { trigger: mockTrigger },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: mockResolveTriggerRegion,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  executeSync: mockExecuteSync,
  isConnectorRunnableStatus: (status: string) => status === 'active' || status === 'error',
}))

vi.mock('@/lib/knowledge/connectors/sync-lock', () => ({
  connectorIsLive: () => ({ type: 'connectorIsLive' }),
  LOCKABLE_CONNECTOR_STATUSES: ['active', 'error', 'pending'],
}))

import {
  assertConnectorSyncPayload,
  dispatchSync,
  SYNC_DISPATCH_FAILED_ERROR,
} from '@/lib/knowledge/connectors/queue'

const BILLING_ATTRIBUTION = {
  actorUserId: 'external-admin',
  workspaceId: 'workspace-paid',
  organizationId: 'organization-paid',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'organization-paid' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: {
    id: 'subscription-paid',
    referenceId: 'organization-paid',
    plan: 'team_25000',
    status: 'active',
    seats: 5,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  },
}
const NEXT_SYNC_AT = new Date('2026-07-15T12:00:00.000Z')

describe('connector sync queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorStatus: 'active',
        connectorAccessMode: 'workspace',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        connectorNextSyncAt: NEXT_SYNC_AT,
        workspaceId: 'workspace-paid',
        kbDeletedAt: null,
      },
    ])
    /** `markSyncPending` now reports whether it actually took the queue entry. */
    dbChainMockFns.returning.mockResolvedValue([{ id: 'connector-1' }])
    mockIsTriggerAvailable.mockReturnValue(true)
    mockCreateIdempotencyKey.mockResolvedValue('idempotency-key')
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  /**
   * The bug this pins: the queue once refused anything but workspace mode, so
   * every admin-mode connector the scheduler selected was dropped before the
   * queue entry was taken, and the content engine's admin branch never ran.
   */
  it('dispatches an admin-mode connector, which the content engine drives', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorStatus: 'active',
        connectorAccessMode: 'admin',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        connectorNextSyncAt: NEXT_SYNC_AT,
        workspaceId: 'workspace-paid',
        kbDeletedAt: null,
      },
    ])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'connector-1' }])

    await expect(
      dispatchSync('connector-1', { billingAttribution: BILLING_ATTRIBUTION, requestId: 'r' })
    ).resolves.toEqual({ queued: true })
    expect(mockTrigger).toHaveBeenCalledTimes(1)
  })

  it('refuses a members-mode connector, which the member engine drives', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorStatus: 'active',
        connectorAccessMode: 'members',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        connectorNextSyncAt: NEXT_SYNC_AT,
        workspaceId: 'workspace-paid',
        kbDeletedAt: null,
      },
    ])

    await expect(
      dispatchSync('connector-1', { billingAttribution: BILLING_ATTRIBUTION, requestId: 'r' })
    ).resolves.toMatchObject({ queued: false })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('preserves the actor and immutable workspace payer in the queued payload', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      fullSync: true,
      requestId: 'request-1',
    })

    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-connector-sync',
      {
        connectorId: 'connector-1',
        fullSync: true,
        requireRunnable: undefined,
        rehydrate: undefined,
        requestId: 'request-1',
        billingAttribution: BILLING_ATTRIBUTION,
        /** Minted per dispatch; its own test asserts it matches the queue entry. */
        dispatchToken: expect.any(String),
      },
      {
        tags: [
          'connectorId:connector-1',
          'knowledgeBaseId:knowledge-base-1',
          'workspaceId:workspace-paid',
          'userId:external-admin',
        ],
        region: 'us-east-1',
      }
    )
  })

  it('carries the rehydrate flag into the queued payload', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      rehydrate: true,
      requestId: 'request-1',
    })

    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-connector-sync',
      expect.objectContaining({ connectorId: 'connector-1', rehydrate: true }),
      expect.anything()
    )
  })

  it('carries the runnable requirement into the queued payload', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      expectedNextSyncAt: NEXT_SYNC_AT,
      requireRunnable: true,
      requestId: 'request-1',
    })

    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-connector-sync',
      expect.objectContaining({ connectorId: 'connector-1', requireRunnable: true }),
      expect.objectContaining({ idempotencyKey: 'idempotency-key' })
    )
    expect(mockCreateIdempotencyKey).toHaveBeenCalledWith(
      `knowledge-connector-sync:connector-1:${NEXT_SYNC_AT.toISOString()}`,
      { scope: 'global' }
    )
  })

  it('skips an automatic dispatch after the due time changes', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      expectedNextSyncAt: new Date('2026-07-15T11:00:00.000Z'),
      requireRunnable: true,
      requestId: 'request-1',
    })

    expect(mockCreateIdempotencyKey).not.toHaveBeenCalled()
    expect(mockTrigger).not.toHaveBeenCalled()
    expect(mockExecuteSync).not.toHaveBeenCalled()
  })

  it('rejects automatic dispatch without an expected due time', async () => {
    await expect(
      dispatchSync('connector-1', {
        billingAttribution: BILLING_ATTRIBUTION,
        requireRunnable: true,
        requestId: 'request-1',
      })
    ).rejects.toThrow('Automatic connector sync dispatch requires the expected next sync time')

    expect(mockTrigger).not.toHaveBeenCalled()
    expect(mockExecuteSync).not.toHaveBeenCalled()
  })

  it('skips automatic dispatch when the connector was paused concurrently', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorStatus: 'paused',
        connectorAccessMode: 'workspace',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        workspaceId: 'workspace-paid',
        kbDeletedAt: null,
      },
    ])

    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      expectedNextSyncAt: NEXT_SYNC_AT,
      requireRunnable: true,
      requestId: 'request-1',
    })

    expect(mockTrigger).not.toHaveBeenCalled()
    expect(mockExecuteSync).not.toHaveBeenCalled()
  })

  /**
   * Every guard here used to return `void`, so a caller could not tell a queued
   * sync from a skipped one and reported — and audited — work that never
   * started.
   */
  it('reports the queue outcome to the caller', async () => {
    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(result).toEqual({ queued: true })
  })

  it('reports why an automatic dispatch on a paused connector was not queued', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorStatus: 'paused',
        connectorAccessMode: 'workspace',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        connectorNextSyncAt: NEXT_SYNC_AT,
        workspaceId: 'workspace-paid',
        kbDeletedAt: null,
      },
    ])

    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      expectedNextSyncAt: NEXT_SYNC_AT,
      requireRunnable: true,
      requestId: 'request-1',
    })

    expect(result.queued).toBe(false)
    expect(result.reason).toContain('paused')
  })

  it('reports why a connector that is not accepting a queued sync was skipped', async () => {
    /** `markSyncPending` took nothing: the row already carries a queue entry. */
    dbChainMockFns.returning.mockResolvedValue([])
    queueTableRows(schemaMock.knowledgeConnector, [
      { status: 'pending', archivedAt: null, deletedAt: null },
    ])

    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(result).toEqual({
      queued: false,
      reason: 'A sync is already queued or running for this connector',
    })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('reports the lifecycle reason when the connector is archived under the queue write', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        status: 'active',
        archivedAt: new Date('2026-08-21T00:00:00.000Z'),
        deletedAt: null,
      },
    ])

    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(result).toEqual({
      queued: false,
      reason: 'Connector has been archived or deleted',
    })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('reports the lifecycle reason when the connector is deleted under the queue write', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    queueTableRows(schemaMock.knowledgeConnector, [])

    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(result).toEqual({ queued: false, reason: 'Connector no longer exists' })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('reports the status when it left the set a run may start from', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    queueTableRows(schemaMock.knowledgeConnector, [
      { status: 'paused', archivedAt: null, deletedAt: null },
    ])

    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(result).toEqual({
      queued: false,
      reason: 'Connector is paused and cannot start a sync',
    })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('reports why a connector whose knowledge base is gone was skipped', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        workspaceId: 'workspace-paid',
        kbDeletedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])

    const result = await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(result).toEqual({ queued: false, reason: 'Knowledge base has been deleted' })
  })

  it('releases the lock when it errors a connector whose knowledge base is gone', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        workspaceId: 'workspace-paid',
        kbDeletedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])

    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    /**
     * This write is unconditional on status, so it can land on a row a previous
     * run left `syncing`. Flipping status without releasing the token and lease
     * left a row that was neither locked nor reclaimable — the reaper only looks
     * at `syncing` rows, and the old run's terminal write could still match its
     * own token.
     */
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncLockToken: null,
        syncLockLeaseAt: null,
      })
    )
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('marks the connector queued before handing the sync off', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    /** `pending` is the only thing distinguishing "a sync is coming" from "idle". */
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
    expect(mockTrigger).toHaveBeenCalled()
  })

  it('opens a lease and takes a token when it queues', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    /**
     * The lease is what the scheduler ages a stranded queue entry against —
     * `updatedAt` cannot serve, because a pending connector is still editable
     * and any unrelated write would renew the recovery it should trigger.
     */
    const payload = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
    expect(payload.syncLockLeaseAt).toBeInstanceOf(Date)
    expect(typeof payload.syncLockToken).toBe('string')
  })

  it('queues a connector that is already pending, so the create path gets a lease and token', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    /**
     * A created connector is born `pending` in its INSERT but with no lease and
     * no token. Skipping it here as a redundant write would leave it ageing
     * against `updatedAt` — which any edit renews — and holding a token this
     * dispatch cannot match, so a failed hand-off would never release it.
     */
    const queueWhere = dbChainMockFns.where.mock.calls
      .map((call) => call[0])
      .find((where) =>
        hasMockCondition(
          where,
          (node: MockCondition) =>
            node.type === 'inArray' && node.column === schemaMock.knowledgeConnector.status
        )
      )
    expect(queueWhere).toBeDefined()

    const lockable = flattenMockConditions(queueWhere).find(
      (node: MockCondition) =>
        node.type === 'inArray' && node.column === schemaMock.knowledgeConnector.status
    )?.values as string[] | undefined

    /** The create path is born `pending`, so queueing must still take that row. */
    expect(lockable).toContain('pending')

    /** An existing queue owner must not have its token replaced by a duplicate dispatch. */
    expect(
      hasMockCondition(
        queueWhere,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.syncLockToken
      )
    ).toBe(true)

    /**
     * A live run owns its row, and a paused or disabled connector must not be
     * pulled back into a queued sync by a dispatch that raced the status change.
     */
    expect(lockable).not.toContain('syncing')
    expect(lockable).not.toContain('paused')
    expect(lockable).not.toContain('disabled')
  })

  it('releases the queued connector when the hand-off throws', async () => {
    mockTrigger.mockRejectedValueOnce(new Error('trigger unavailable'))

    await expect(
      dispatchSync('connector-1', {
        billingAttribution: BILLING_ATTRIBUTION,
        requestId: 'request-1',
      })
    ).rejects.toThrow('trigger unavailable')

    /**
     * Left `pending`, the connector would sit with a sync that is never coming:
     * the scheduler's due-sweep only looks at `active`/`error` rows.
     */
    const released = dbChainMockFns.set.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(released.status).toBe('error')
    expect(released.lastSyncError).toBe(SYNC_DISPATCH_FAILED_ERROR)
    expect(released.syncLockToken).toBeNull()

    /**
     * The verdict is about the queue, not the connector, so it must not advance
     * the auto-disable breaker — a queue outage would otherwise increment every
     * connector in the fleet until they all disabled themselves.
     */
    expect(released).not.toHaveProperty('consecutiveFailures')
    expect(released.nextSyncAt).toBeInstanceOf(Date)

    /**
     * Guarded on this dispatch's own token, not merely on `pending`. A hand-off
     * can throw long after the scheduler reclaimed the queue entry and
     * dispatched a replacement; without the token this dead dispatch would
     * overwrite the live one.
     */
    const queuedToken = (dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>)
      .syncLockToken
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls.at(-1)?.[0],
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.syncLockToken &&
          node.right === queuedToken
      )
    ).toBe(true)
  })

  it('does not queue a connector whose knowledge base is gone', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        workspaceId: 'workspace-paid',
        kbDeletedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])

    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    )
  })

  it('stamps the queue entry token onto the task so the worker can prove ownership', async () => {
    await dispatchSync('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      requestId: 'request-1',
    })

    /**
     * Without this the status check alone lets a task delayed past its lease
     * take the replacement entry the reaper's re-dispatch created, running
     * superseded options while the replacement is turned away.
     */
    const queuedToken = (dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>)
      .syncLockToken
    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-connector-sync',
      expect.objectContaining({ dispatchToken: queuedToken }),
      expect.anything()
    )
  })

  it('tolerates a payload queued before the token existed', () => {
    /** In-flight tasks from before this field shipped must not be stranded. */
    expect(
      assertConnectorSyncPayload({
        connectorId: 'connector-1',
        requestId: 'request-1',
        billingAttribution: BILLING_ATTRIBUTION,
      }).dispatchToken
    ).toBeUndefined()
  })

  it('rejects legacy payloads without billing attribution', () => {
    expect(() =>
      assertConnectorSyncPayload({
        connectorId: 'connector-1',
        requestId: 'request-1',
      })
    ).toThrow('Connector sync payload requires billing attribution')
  })

  it('rejects attribution captured for a different workspace', async () => {
    await expect(
      dispatchSync('connector-1', {
        billingAttribution: {
          ...BILLING_ATTRIBUTION,
          workspaceId: 'workspace-other',
        },
        requestId: 'request-1',
      })
    ).rejects.toThrow('Billing attribution does not match resource owner')

    expect(mockTrigger).not.toHaveBeenCalled()
  })
})
