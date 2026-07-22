/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSync, mockIsTriggerAvailable, mockResolveTriggerRegion, mockTrigger } =
  vi.hoisted(() => ({
    mockExecuteSync: vi.fn(),
    mockIsTriggerAvailable: vi.fn(),
    mockResolveTriggerRegion: vi.fn(),
    mockTrigger: vi.fn(),
  }))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mockTrigger } }))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: mockResolveTriggerRegion,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  executeSync: mockExecuteSync,
}))

import { assertConnectorSyncPayload, dispatchSync } from '@/lib/knowledge/connectors/queue'

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
