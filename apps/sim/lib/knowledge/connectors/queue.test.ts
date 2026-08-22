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

const { mockExecuteSync, mockIsTriggerAvailable, mockResolveTriggerRegion, mockTrigger } =
  vi.hoisted(() => ({
    mockExecuteSync: vi.fn(),
    mockIsTriggerAvailable: vi.fn(),
    mockResolveTriggerRegion: vi.fn(),
    mockTrigger: vi.fn(),
  }))

vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mockTrigger } }))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: mockResolveTriggerRegion,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  executeSync: mockExecuteSync,
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

describe('connector sync queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        knowledgeBaseId: 'knowledge-base-1',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        workspaceId: 'workspace-paid',
        kbDeletedAt: null,
      },
    ])
    /** `markSyncPending` now reports whether it actually took the queue entry. */
    dbChainMockFns.returning.mockResolvedValue([{ id: 'connector-1' }])
    mockIsTriggerAvailable.mockReturnValue(true)
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
  })

  afterAll(() => {
    resetDbChainMock()
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
        rehydrate: undefined,
        requestId: 'request-1',
        billingAttribution: BILLING_ATTRIBUTION,
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
    ).rejects.toThrow('does not match connector workspace workspace-paid')

    expect(mockTrigger).not.toHaveBeenCalled()
  })
})
