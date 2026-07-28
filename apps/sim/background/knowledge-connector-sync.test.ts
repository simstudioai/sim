/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertConnectorSyncPayload, mockExecuteSync, mockTask } = vi.hoisted(() => ({
  mockAssertConnectorSyncPayload: vi.fn(),
  mockExecuteSync: vi.fn(),
  mockTask: vi.fn((config) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))
vi.mock('@/lib/knowledge/connectors/queue', () => ({
  assertConnectorSyncPayload: mockAssertConnectorSyncPayload,
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  executeSync: mockExecuteSync,
}))

import { executeConnectorSyncJob } from '@/background/knowledge-connector-sync'

const BILLING_ATTRIBUTION = {
  actorUserId: 'external-admin',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user' as const, id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

describe('knowledge connector sync worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteSync.mockResolvedValue({
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsFailed: 0,
    })
  })

  it('rejects a legacy job before sync execution', async () => {
    mockAssertConnectorSyncPayload.mockImplementation(() => {
      throw new Error('Connector sync payload requires billing attribution')
    })

    await expect(
      executeConnectorSyncJob({ connectorId: 'connector-1', requestId: 'request-1' })
    ).rejects.toThrow('Connector sync payload requires billing attribution')
    expect(mockExecuteSync).not.toHaveBeenCalled()
  })

  it('forwards the validated actor and payer snapshot to the sync engine', async () => {
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      fullSync: true,
      billingAttribution: BILLING_ATTRIBUTION,
    })

    await executeConnectorSyncJob({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })

    expect(mockExecuteSync).toHaveBeenCalledWith('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      fullSync: true,
      rehydrate: undefined,
    })
  })

  it('forwards the rehydrate flag to the sync engine (async worker path)', async () => {
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      rehydrate: true,
      billingAttribution: BILLING_ATTRIBUTION,
    })

    await executeConnectorSyncJob({
      connectorId: 'connector-1',
      requestId: 'request-1',
      rehydrate: true,
      billingAttribution: BILLING_ATTRIBUTION,
    })

    expect(mockExecuteSync).toHaveBeenCalledWith('connector-1', {
      billingAttribution: BILLING_ATTRIBUTION,
      fullSync: undefined,
      rehydrate: true,
    })
  })
})
