/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { providerHandler } = vi.hoisted(() => ({
  providerHandler: {
    createSubscription: vi.fn(),
  },
}))

vi.mock('@/lib/webhooks/providers', () => ({
  getProviderHandler: vi.fn(() => providerHandler),
}))

import type { NextRequest } from 'next/server'
import {
  cleanupRetiredWebhookRegistrationsAfterActivation,
  prepareStableWebhookRegistrations,
  type StableWebhookRegistrationDependencies,
} from '@/lib/webhooks/registration-service'
import {
  buildLegacyInvisibleCandidateValues,
  type DesiredWebhookRegistrationIntent,
  type WebhookRegistrationOperationFence,
  type WebhookRegistrationRow,
} from '@/lib/webhooks/registration-store'

const fence: WebhookRegistrationOperationFence = {
  workflowId: 'workflow-1',
  operationId: 'operation-5',
  generation: 5,
  deploymentVersionId: 'version-5',
}

function registrationRow(overrides: Partial<WebhookRegistrationRow> = {}): WebhookRegistrationRow {
  return {
    id: 'webhook-1',
    workflowId: fence.workflowId,
    deploymentVersionId: 'version-4',
    registrationStatus: 'active',
    registrationGeneration: 4,
    configFingerprint: 'old-fingerprint',
    preparedAt: new Date('2026-01-01T00:00:00Z'),
    blockId: 'trigger-1',
    path: 'events',
    routingKey: null,
    provider: 'parallel-provider',
    providerConfig: { externalId: 'external-old', cursor: 'cursor-9' },
    isActive: true,
    failedCount: 3,
    lastFailedAt: new Date('2026-01-02T00:00:00Z'),
    archivedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<StableWebhookRegistrationDependencies> = {}
): StableWebhookRegistrationDependencies {
  return {
    prepareIntents: vi.fn(),
    checkpointCandidate: vi.fn(),
    listRetired: vi.fn(),
    getCleanupSnapshot: vi.fn(),
    deleteAfterCleanup: vi.fn(),
    createExternal: vi.fn(),
    cleanupExternal: vi.fn(),
    ...overrides,
  } as unknown as StableWebhookRegistrationDependencies
}

describe('stable webhook registration service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists candidate intent as invisible to legacy delivery queries', () => {
    const now = new Date('2026-07-14T00:00:00Z')
    const desired: DesiredWebhookRegistrationIntent = {
      blockId: 'trigger-1',
      provider: 'parallel-provider',
      path: '/events/',
      routingKey: null,
      providerConfig: { event: 'created' },
      configFingerprint: 'fingerprint-5',
    }

    const values = buildLegacyInvisibleCandidateValues({
      id: 'candidate-5',
      fence,
      desired,
      now,
    })

    expect(values).toMatchObject({
      registrationStatus: 'candidate',
      registrationGeneration: 5,
      path: 'events',
      isActive: false,
      archivedAt: now,
      preparedAt: null,
    })
  })

  it('never touches the live subscription when candidate preparation fails', async () => {
    const candidate = registrationRow({
      id: 'candidate-5',
      deploymentVersionId: fence.deploymentVersionId,
      registrationStatus: 'candidate',
      registrationGeneration: fence.generation,
      configFingerprint: 'new-fingerprint',
      preparedAt: null,
      providerConfig: { event: 'updated' },
      isActive: false,
      failedCount: 0,
      lastFailedAt: null,
      archivedAt: new Date('2026-07-14T00:00:00Z'),
    })
    const createExternal = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const cleanupExternal = vi.fn()
    const checkpointCandidate = vi.fn()
    const store = dependencies({
      prepareIntents: vi.fn().mockResolvedValue({
        candidates: [
          {
            desired: {
              blockId: 'trigger-1',
              provider: 'parallel-provider',
              path: 'events',
              routingKey: null,
              providerConfig: { event: 'updated' },
              configFingerprint: 'new-fingerprint',
            },
            row: candidate,
          },
        ],
        orphanedCandidates: [],
      }),
      createExternal,
      cleanupExternal,
      checkpointCandidate,
    })

    await expect(
      prepareStableWebhookRegistrations(
        {
          request: {} as NextRequest,
          fence,
          workflow: { id: fence.workflowId },
          userId: 'user-1',
          requestId: 'request-1',
          desired: [
            {
              blockId: 'trigger-1',
              provider: 'parallel-provider',
              path: 'events',
              routingKey: null,
              providerConfig: { event: 'updated' },
              desiredConfig: { event: 'updated' },
            },
          ],
        },
        store
      )
    ).rejects.toThrow('Failed to prepare 1 webhook registration')

    expect(createExternal).toHaveBeenCalledTimes(1)
    expect(cleanupExternal).not.toHaveBeenCalled()
    expect(checkpointCandidate).not.toHaveBeenCalled()
  })

  it('durably records the external subscription before finishing preparation', async () => {
    const candidate = registrationRow({
      id: 'candidate-5',
      deploymentVersionId: fence.deploymentVersionId,
      registrationStatus: 'candidate',
      registrationGeneration: fence.generation,
      configFingerprint: 'new-fingerprint',
      preparedAt: null,
      providerConfig: null,
      isActive: false,
      archivedAt: new Date('2026-07-14T00:00:00Z'),
    })
    const abortController = new AbortController()
    const createExternal = vi.fn().mockResolvedValue({
      updatedProviderConfig: { event: 'updated', externalId: 'external-new' },
      externalSubscriptionCreated: true,
    })
    const cleanupExternal = vi.fn()
    const checkpointCandidate = vi.fn()
    const store = dependencies({
      prepareIntents: vi.fn().mockResolvedValue({
        candidates: [
          {
            desired: {
              blockId: 'trigger-1',
              provider: 'parallel-provider',
              path: 'events',
              routingKey: null,
              providerConfig: { event: 'updated' },
              configFingerprint: 'new-fingerprint',
            },
            row: candidate,
          },
        ],
        orphanedCandidates: [],
      }),
      createExternal,
      cleanupExternal,
      checkpointCandidate,
    })

    await prepareStableWebhookRegistrations(
      {
        request: {} as NextRequest,
        fence,
        workflow: { id: fence.workflowId },
        userId: 'user-1',
        requestId: 'request-1',
        signal: abortController.signal,
        desired: [
          {
            blockId: 'trigger-1',
            provider: 'parallel-provider',
            path: 'events',
            routingKey: null,
            providerConfig: { event: 'updated' },
            desiredConfig: { event: 'updated' },
          },
        ],
      },
      store
    )

    expect(cleanupExternal).not.toHaveBeenCalled()
    expect(createExternal.mock.calls[0][5]).toEqual({ signal: abortController.signal })
    expect(checkpointCandidate).toHaveBeenCalledTimes(2)
    expect(checkpointCandidate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        prepared: false,
        providerConfig: { event: 'updated', externalId: 'external-new' },
      })
    )
    expect(checkpointCandidate.mock.calls[1][0]).not.toHaveProperty('prepared')
  })

  it('skips external cleanup when the row was reused by a newer generation', async () => {
    const staleRetired = registrationRow({
      registrationStatus: 'retired',
      isActive: false,
      archivedAt: new Date(),
    })
    const cleanupExternal = vi.fn()
    const deleteAfterCleanup = vi.fn()
    const store = dependencies({
      listRetired: vi.fn().mockResolvedValueOnce([staleRetired]).mockResolvedValue([]),
      getCleanupSnapshot: vi.fn().mockResolvedValue(null),
      cleanupExternal,
      deleteAfterCleanup,
    })

    await cleanupRetiredWebhookRegistrationsAfterActivation(
      {
        fence,
        workflow: { id: fence.workflowId },
        requestId: 'request-cleanup',
      },
      store
    )

    expect(cleanupExternal).not.toHaveBeenCalled()
    expect(deleteAfterCleanup).not.toHaveBeenCalled()
  })
})
