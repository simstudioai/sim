/**
 * @vitest-environment node
 */

import { AbortTaskRunError } from '@trigger.dev/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertConnectorSyncPayload, mockExecuteSync, mockTask } = vi.hoisted(() => ({
  mockAssertConnectorSyncPayload: vi.fn(),
  mockExecuteSync: vi.fn(),
  mockTask: vi.fn((config) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: mockTask,
  AbortTaskRunError: class AbortTaskRunError extends Error {},
}))
vi.mock('@/lib/knowledge/connectors/queue', () => ({
  assertConnectorSyncPayload: mockAssertConnectorSyncPayload,
}))
vi.mock('@/lib/knowledge/connectors/sync-engine', () => ({
  executeSync: mockExecuteSync,
}))

import {
  classifyConnectorSyncResult,
  executeConnectorSyncJob,
} from '@/background/knowledge-connector-sync'

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
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
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
      requireRunnable: true,
      dispatchToken: 'dispatch-1',
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
      requireRunnable: true,
      rehydrate: undefined,
      dispatchToken: 'dispatch-1',
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
      requireRunnable: undefined,
      rehydrate: true,
      dispatchToken: undefined,
    })
  })

  it('fails visibly without retrying an already-persisted partial sync', async () => {
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })
    mockExecuteSync.mockResolvedValue({
      docsAdded: 2,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 3,
      docsFailed: 1,
      processingDispatch: { requested: 2, accepted: 1, failed: 1 },
    })

    const run = executeConnectorSyncJob({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })

    await expect(run).rejects.toBeInstanceOf(AbortTaskRunError)
    await expect(run).rejects.toThrow('Connector sync partially failed')
  })

  it('does not turn intentionally skipped source files into a task failure', () => {
    expect(
      classifyConnectorSyncResult({
        docsAdded: 0,
        docsUpdated: 0,
        docsDeleted: 0,
        docsUnchanged: 0,
        docsSkipped: 4,
        docsFailed: 0,
        processingDispatch: { requested: 0, accepted: 0, failed: 0 },
      })
    ).toBe('completed')
  })

  it('classifies an isolated processing dispatch failure as partial', () => {
    expect(
      classifyConnectorSyncResult({
        docsAdded: 1,
        docsUpdated: 0,
        docsDeleted: 0,
        docsUnchanged: 0,
        docsSkipped: 0,
        docsFailed: 0,
        processingDispatch: { requested: 1, accepted: 0, failed: 1 },
      })
    ).toBe('partial')
  })

  it('reports superseded and non-runnable jobs as skipped control flow', () => {
    const baseResult = {
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
    }

    expect(classifyConnectorSyncResult({ ...baseResult, skipReason: 'sync_superseded' })).toBe(
      'skipped'
    )
    expect(
      classifyConnectorSyncResult({ ...baseResult, skipReason: 'connector_not_syncable' })
    ).toBe('skipped')
  })

  it('never treats a provider error that collides with a skip reason as control flow', () => {
    expect(
      classifyConnectorSyncResult({
        docsAdded: 0,
        docsUpdated: 0,
        docsDeleted: 0,
        docsUnchanged: 0,
        docsSkipped: 0,
        docsFailed: 0,
        processingDispatch: { requested: 0, accepted: 0, failed: 0 },
        error: 'sync_in_progress',
      })
    ).toBe('failed')
  })

  it('reports a durable continuation without aborting or retrying its completed pages', async () => {
    const result = {
      docsAdded: 1,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 1, accepted: 1, failed: 0 },
      listingIncomplete: true,
    }
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })
    mockExecuteSync.mockResolvedValue(result)
    expect(classifyConnectorSyncResult(result)).toBe('partial')
    await expect(executeConnectorSyncJob({})).resolves.toMatchObject({
      outcome: 'partial',
      listingIncomplete: true,
    })
  })

  it('classifies a persisted connector error as a failed task', () => {
    expect(
      classifyConnectorSyncResult({
        docsAdded: 0,
        docsUpdated: 0,
        docsDeleted: 0,
        docsUnchanged: 0,
        docsSkipped: 0,
        docsFailed: 0,
        processingDispatch: { requested: 0, accepted: 0, failed: 0 },
        error: 'provider unavailable',
      })
    ).toBe('failed')
  })

  it('fails the Trigger run for a persisted connector error without a whole-sync retry', async () => {
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })
    mockExecuteSync.mockResolvedValue({
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
      error: 'provider unavailable',
    })

    const run = executeConnectorSyncJob({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })

    await expect(run).rejects.toBeInstanceOf(AbortTaskRunError)
    await expect(run).rejects.toThrow('Connector sync failed for connector-1: provider unavailable')
  })

  it('returns an explicit skipped outcome for a superseded task', async () => {
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })
    mockExecuteSync.mockResolvedValue({
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
      skipReason: 'dispatch_superseded',
    })

    await expect(
      executeConnectorSyncJob({
        connectorId: 'connector-1',
        requestId: 'request-1',
        billingAttribution: BILLING_ATTRIBUTION,
      })
    ).resolves.toMatchObject({
      success: false,
      outcome: 'skipped',
      skipReason: 'dispatch_superseded',
    })
  })
})
