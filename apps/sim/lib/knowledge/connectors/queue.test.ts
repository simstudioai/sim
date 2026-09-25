import {
  dbChainMockFns,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
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
vi.mock('@/lib/core/config/trigger-availability', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  executeSync: mockExecuteSync,
  isConnectorRunnableStatus: (status: string) => status === 'active' || status === 'error',
}))

vi.mock('@/lib/knowledge/connectors/sync-lock', () => ({
  buildSyncUnscheduledUpdate: (now: Date, lastSyncError: string) => ({
    status: 'error',
    lastSyncError,
    nextSyncAt: null,
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }),
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
    resetEnvFlagsMock()
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

  it.each([false, true])(
    'rejects a rapid manual repeat before queueing (rehydrate: %s)',
    async (rehydrate) => {
      queueTableRows(schemaMock.knowledgeConnector, [{ status: 'active', lastSyncError: null }])
      queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
        { status: 'completed', completedAt: new Date(), failures: 0 },
      ])
      await expect(
        dispatchSync('connector-1', {
          billingAttribution: BILLING_ATTRIBUTION,
          manual: true,
          rehydrate,
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockTrigger).not.toHaveBeenCalled()
      expect(mockExecuteSync).not.toHaveBeenCalled()
    }
  )

  it('does not dispatch a live Search source to Trigger or the inline indexer', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    resetDbChainMock()
    queueTableRows(schemaMock.knowledgeConnector, [{ isSearchIndex: true }])
    expect(await dispatchSync('connector-1', { billingAttribution: BILLING_ATTRIBUTION })).toEqual({
      queued: false,
      reason: 'This source is searched live and does not require indexing.',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockTrigger).not.toHaveBeenCalled()
    expect(mockExecuteSync).not.toHaveBeenCalled()
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
