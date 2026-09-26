import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { AbortTaskRunError } from '@trigger.dev/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertConnectorSyncPayload, mockExecuteSync } = vi.hoisted(() => ({
  mockAssertConnectorSyncPayload: vi.fn(),
  mockExecuteSync: vi.fn(),
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

const { warn: mockWarn } = getMockLogger('TriggerKnowledgeConnectorSync')

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

  it('returns a partial sync as an outcome instead of failing the run', async () => {
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

    await expect(run).resolves.toMatchObject({
      success: false,
      outcome: 'partial',
      docsFailed: 1,
      processingDispatch: { failed: 1 },
    })
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('1 source failures, 1 dispatch failures')
    )
  })

  it('completes a durably scheduled capacity wait while preserving existing source failures', async () => {
    mockAssertConnectorSyncPayload.mockReturnValue({
      connectorId: 'connector-1',
      requestId: 'request-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })
    const base = await mockExecuteSync()
    const waiting = {
      ...base,
      listingIncomplete: true,
      deferred: {
        reason: 'admission_timeout',
        providerId: 'github-rest',
        nextSyncAt: '2026-09-01T00:00:00Z',
      },
    }
    mockExecuteSync.mockResolvedValue(waiting)
    expect(await executeConnectorSyncJob({})).toMatchObject({
      outcome: 'deferred',
      success: false,
      deferred: waiting.deferred,
    })
    mockExecuteSync.mockResolvedValue({ ...waiting, docsFailed: 1 })
    expect(await executeConnectorSyncJob({})).toMatchObject({ outcome: 'partial', success: false })
    mockExecuteSync.mockResolvedValue({ ...waiting, error: 'Retry persistence failed' })
    await expect(executeConnectorSyncJob({})).rejects.toThrow('Retry persistence failed')
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
    expect(mockWarn).not.toHaveBeenCalled()
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
})
