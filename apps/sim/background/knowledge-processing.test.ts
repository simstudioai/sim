/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingAttributionSnapshot,
  mockProcessDocumentAsync,
  mockResolveTriggerRegion,
  mockTask,
  mockTrigger,
} = vi.hoisted(() => ({
  mockAssertBillingAttributionSnapshot: vi.fn(),
  mockProcessDocumentAsync: vi.fn(),
  mockResolveTriggerRegion: vi.fn(),
  mockTask: vi.fn((config) => config),
  mockTrigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask, tasks: { trigger: mockTrigger } }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: mockResolveTriggerRegion }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  processDocumentAsync: mockProcessDocumentAsync,
}))

import { EmbeddingQuotaExhaustedError } from '@/lib/embeddings/client'
import { EMBEDDING_QUOTA_CIRCUIT_TTL_MS } from '@/lib/embeddings/quota-circuit'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import {
  resolveQuotaContinuationDelayMs,
  runDocumentProcessing,
} from '@/background/knowledge-processing'

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

const BASE_PAYLOAD = {
  knowledgeBaseId: 'knowledge-base-1',
  documentId: 'document-1',
  docData: {
    filename: 'document.txt',
    fileUrl: 'https://example.com/document.txt',
    fileSize: 128,
    mimeType: 'text/plain',
  },
  processingOptions: {},
  requestId: 'request-1',
  processingQueuedAt: '2026-08-24T22:00:00.000Z',
}

const WORKSPACE_PAYLOAD = {
  ...BASE_PAYLOAD,
  billingScope: 'workspace' as const,
  actorUserId: 'external-admin',
  workspaceId: 'workspace-1',
  billingAttribution: BILLING_ATTRIBUTION,
}

describe('knowledge processing worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertBillingAttributionSnapshot.mockImplementation((value) => {
      if (!value) {
        throw new Error('Billing attribution snapshot must be an object')
      }
      return value
    })
    mockProcessDocumentAsync.mockResolvedValue(undefined)
    mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'quota-continuation-run' })
  })

  it('rejects workspace work without attribution before document processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        billingScope: 'workspace',
        actorUserId: 'external-admin',
        workspaceId: 'workspace-1',
      })
    ).rejects.toThrow('Workspace document processing requires a billing attribution snapshot')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('rejects an invalid durable quota retry count before processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        quotaRetryCount: -1,
      })
    ).rejects.toThrow('Document processing quota retry count is invalid')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('rejects an invalid queue-generation stamp before processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        processingQueuedAt: 'not-a-date',
      })
    ).rejects.toThrow('Document processing queue stamp is invalid')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('preserves the validated actor and payer snapshot through serialization', async () => {
    await runDocumentProcessing(structuredClone(WORKSPACE_PAYLOAD))

    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      {
        billingScope: 'workspace',
        actorUserId: 'external-admin',
        workspaceId: 'workspace-1',
        billingAttribution: BILLING_ATTRIBUTION,
      },
      BASE_PAYLOAD.requestId,
      {
        chargedAtDispatch: true,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
      }
    )
  })

  it('rejects an actor mismatch before document processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        actorUserId: 'different-actor',
      })
    ).rejects.toThrow('Document processing actor does not match billing attribution')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('rejects a workspace mismatch before document processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        workspaceId: 'workspace-2',
      })
    ).rejects.toThrow('Document processing workspace does not match billing attribution')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('preserves explicit non-workspace processing without workspace attribution', async () => {
    await runDocumentProcessing({
      ...BASE_PAYLOAD,
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })

    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      {
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      },
      BASE_PAYLOAD.requestId,
      {
        chargedAtDispatch: true,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
      }
    )
  })

  it('reports elapsed processing time rather than an epoch timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_125)

    const result = await runDocumentProcessing({
      ...BASE_PAYLOAD,
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })

    expect(result.processingTime).toBe(125)
  })

  it('returns a controlled terminal result for permanent document input failures', async () => {
    mockProcessDocumentAsync.mockRejectedValue(
      new PermanentDocumentProcessingError(
        'archive_safety_limit',
        'This file expands beyond the safe processing limit.'
      )
    )

    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      })
    ).resolves.toMatchObject({
      success: false,
      outcome: 'permanent_failure',
      code: 'archive_safety_limit',
      error: 'This file expands beyond the safe processing limit.',
    })
  })

  it('preserves normal retries for transient failures', async () => {
    const transientError = new Error('Database connection timed out')
    mockProcessDocumentAsync.mockRejectedValue(transientError)

    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      })
    ).rejects.toBe(transientError)
  })

  it('durably continues quota exhaustion beyond the task attempt budget', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const quotaError = new EmbeddingQuotaExhaustedError('openai')
    mockProcessDocumentAsync.mockRejectedValue(quotaError)

    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      })
    ).resolves.toMatchObject({ success: false, outcome: 'quota_deferred' })

    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-process-document',
      expect.objectContaining({
        documentId: 'document-1',
        requestId: 'request-1',
        quotaRetryCount: 1,
      }),
      expect.objectContaining({
        delay: new Date(1_000 + EMBEDDING_QUOTA_CIRCUIT_TTL_MS),
        idempotencyKey: 'knowledge-quota-document-1-request-1-1',
        region: 'us-east-1',
      })
    )
  })

  it('keeps the task failed when the durable continuation handoff fails', async () => {
    mockProcessDocumentAsync.mockRejectedValue(new EmbeddingQuotaExhaustedError('openai'))
    const dispatchError = new Error('Trigger dispatch unavailable')
    mockTrigger.mockRejectedValue(dispatchError)

    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      })
    ).rejects.toBe(dispatchError)
  })

  it('continues an existing quota chain with the same indexing pass identity', async () => {
    mockProcessDocumentAsync.mockRejectedValue(new EmbeddingQuotaExhaustedError('openai'))

    await runDocumentProcessing({
      ...BASE_PAYLOAD,
      quotaRetryCount: 3,
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })

    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-process-document',
      expect.objectContaining({ requestId: 'request-1', quotaRetryCount: 4 }),
      expect.objectContaining({
        idempotencyKey: 'knowledge-quota-document-1-request-1-4',
      })
    )
  })

  it('does not refund the original dispatch charge again on a task retry', async () => {
    await runDocumentProcessing(
      {
        ...BASE_PAYLOAD,
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      },
      2
    )

    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      {
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      },
      BASE_PAYLOAD.requestId,
      {
        chargedAtDispatch: false,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
      }
    )
  })

  it('preserves the queue generation without refunding a quota continuation run', async () => {
    await runDocumentProcessing({
      ...BASE_PAYLOAD,
      quotaRetryCount: 3,
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })

    expect(mockProcessDocumentAsync).toHaveBeenLastCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      expect.objectContaining({ billingScope: 'non-workspace' }),
      BASE_PAYLOAD.requestId,
      {
        chargedAtDispatch: false,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
      }
    )
  })
})

describe('knowledge-process-document task configuration', () => {
  /**
   * `maxAttempts` does not cover an out-of-memory kill — Trigger.dev retries
   * `TASK_PROCESS_OOM_KILLED` only when a larger preset is named. Eleven
   * documents were killed in one afternoon and every one recorded
   * `attempt_count = 1`, so each was left `failed` having never been retried.
   */
  it('escalates to a larger machine on an out-of-memory kill', async () => {
    const { processDocument } = await import('@/background/knowledge-processing')

    expect(processDocument.retry?.outOfMemory?.machine).toBe('large-2x')
  })

  it('backs durable quota continuations off to a bounded polling interval', () => {
    expect(resolveQuotaContinuationDelayMs(1)).toBe(EMBEDDING_QUOTA_CIRCUIT_TTL_MS)
    expect(resolveQuotaContinuationDelayMs(2)).toBe(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 2)
    expect(resolveQuotaContinuationDelayMs(Number.MAX_SAFE_INTEGER)).toBe(6 * 60 * 60 * 1000)
  })
})
