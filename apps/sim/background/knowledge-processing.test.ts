/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EmbeddingAPIError, EmbeddingQuotaExhaustedError } from '@/lib/embeddings/client'
import { EMBEDDING_QUOTA_CIRCUIT_TTL_MS } from '@/lib/embeddings/quota-circuit'
import {
  OcrRequestRejectedError,
  PermanentDocumentProcessingError,
  UsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import { MAX_PROVIDER_CONTINUATION_ATTEMPTS } from '@/lib/knowledge/documents/processing-provider-continuation'
import { MAX_QUOTA_CONTINUATION_ATTEMPTS } from '@/lib/knowledge/documents/processing-quota-continuation'
import type { DocumentProcessingAttemptContext } from '@/lib/knowledge/documents/service'
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

const ORGANIZATION_PAYLOAD = {
  ...BASE_PAYLOAD,
  billingScope: 'organization' as const,
  actorUserId: 'organization-member',
  workspaceId: null,
  organizationId: 'organization-1',
  billingAttribution: {
    ...BILLING_ATTRIBUTION,
    actorUserId: 'organization-member',
    workspaceId: null,
    organizationId: 'organization-1',
    billingEntity: { type: 'organization' as const, id: 'organization-1' },
  },
}

function mockQuotaExhaustion(error: EmbeddingQuotaExhaustedError): void {
  mockProcessDocumentAsync.mockImplementation(async (...args: unknown[]) => {
    const attemptContext = args[6] as {
      scheduleQuotaContinuation?: () => Promise<unknown>
    }
    await attemptContext.scheduleQuotaContinuation?.()
    throw error
  })
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

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('rejects a queue token that is not the request generation', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        processingQueueToken: 'another-request',
      })
    ).rejects.toThrow('Document processing queue token is invalid')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('rejects a new queue token without its canonical queue stamp', async () => {
    const { processingQueuedAt: _processingQueuedAt, ...payloadWithoutStamp } = WORKSPACE_PAYLOAD

    await expect(
      runDocumentProcessing({
        ...payloadWithoutStamp,
        processingQueueToken: 'request-1',
      })
    ).rejects.toThrow('Document processing payload is missing its queue stamp')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('rejects a new dispatch charge marker without a queue token', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        chargedAtDispatch: true,
      })
    ).rejects.toThrow('Document processing dispatch charge marker requires a queue token')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('accepts a literal pre-rollout staging payload without synthesizing a generation stamp', async () => {
    const { processingQueuedAt: _processingQueuedAt, ...stagingPayload } = WORKSPACE_PAYLOAD

    await runDocumentProcessing(stagingPayload)

    expect(mockProcessDocumentAsync).toHaveBeenLastCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      expect.objectContaining({ billingScope: 'workspace' }),
      'request-1',
      expect.objectContaining({
        chargedAtDispatch: false,
        scheduleQuotaContinuation: expect.any(Function),
      })
    )
  })

  it('propagates a new queue token while accepting legacy queuedAt-only payloads', async () => {
    await runDocumentProcessing({
      ...WORKSPACE_PAYLOAD,
      processingQueueToken: 'request-1',
      chargedAtDispatch: false,
    })

    expect(mockProcessDocumentAsync).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      'request-1',
      expect.objectContaining({
        chargedAtDispatch: false,
        processingQueueToken: 'request-1',
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
      })
    )
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
      expect.objectContaining({
        chargedAtDispatch: true,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
        scheduleQuotaContinuation: expect.any(Function),
      })
    )
  })

  it('preserves organization ownership and billing attribution in the worker', async () => {
    await runDocumentProcessing(structuredClone(ORGANIZATION_PAYLOAD))

    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      BASE_PAYLOAD.knowledgeBaseId,
      BASE_PAYLOAD.documentId,
      BASE_PAYLOAD.docData,
      BASE_PAYLOAD.processingOptions,
      {
        billingScope: 'organization',
        actorUserId: ORGANIZATION_PAYLOAD.actorUserId,
        workspaceId: null,
        organizationId: ORGANIZATION_PAYLOAD.organizationId,
        billingAttribution: ORGANIZATION_PAYLOAD.billingAttribution,
      },
      BASE_PAYLOAD.requestId,
      expect.objectContaining({
        chargedAtDispatch: true,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
      })
    )
  })

  it('rejects an organization mismatch before document processing starts', async () => {
    await expect(
      runDocumentProcessing({ ...ORGANIZATION_PAYLOAD, organizationId: 'organization-2' })
    ).rejects.toThrow('Document processing organization does not match billing attribution')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
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
      expect.objectContaining({
        chargedAtDispatch: true,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
        scheduleQuotaContinuation: expect.any(Function),
      })
    )
  })

  it('carries the actual parent admission flag when Trigger attempt two hands off quickly', async () => {
    const error = new ProviderCapacityDeferredError('rate_limit')
    mockProcessDocumentAsync.mockImplementation(async (...args: unknown[]) => {
      const context = args[6] as {
        scheduleProviderContinuation: (error: ProviderCapacityDeferredError) => Promise<unknown>
      }
      await context.scheduleProviderContinuation(error)
      throw error
    })
    await runDocumentProcessing(
      { ...WORKSPACE_PAYLOAD, processingQueueToken: 'request-1', chargedAtDispatch: true },
      2
    )
    expect(mockTrigger.mock.calls[0][1]).toMatchObject({
      processingPredecessorToken: 'request-1',
      processingPredecessorCharged: false,
    })
  })

  it('does not refund the original dispatch again when a healthy processing slice resumes', async () => {
    await runDocumentProcessing({
      ...WORKSPACE_PAYLOAD,
      processingQueueToken: 'knowledge-slice-document-1-request-1-1',
      processingSliceCount: 1,
      providerRetryStartedAt: new Date().toISOString(),
      chargedAtDispatch: true,
    })
    expect(mockProcessDocumentAsync.mock.calls[0][6]).toMatchObject({
      chargedAtDispatch: false,
      processingQueueToken: 'knowledge-slice-document-1-request-1-1',
    })
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

  it('completes provider-rejected OCR runs without requesting futile Trigger retries', async () => {
    mockProcessDocumentAsync.mockRejectedValue(
      new Error('OCR chunk batch failed', {
        cause: new AggregateError([
          new OcrRequestRejectedError(400),
          new ProviderCapacityDeferredError('rate_limit'),
        ]),
      })
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
      outcome: 'provider_request_rejected',
      code: 'ocr_request_rejected',
    })
  })

  it('reports a mutable usage-limit outcome without requesting an immediate retry', async () => {
    mockProcessDocumentAsync.mockRejectedValue(
      new UsageLimitDocumentProcessingError('Usage limit exceeded. Upgrade to continue.')
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
      outcome: 'usage_limit',
      error: 'Usage limit exceeded. Upgrade to continue.',
    })
  })

  it('returns an actionable outcome when customer-managed embedding credentials are rejected', async () => {
    mockProcessDocumentAsync.mockRejectedValue(
      new EmbeddingAPIError('Embedding API failed: 401', 401, true)
    )

    await expect(runDocumentProcessing(WORKSPACE_PAYLOAD)).resolves.toMatchObject({
      success: false,
      outcome: 'customer_configuration',
      code: 'embedding_credentials_rejected',
      error:
        'The configured embedding API key was rejected. Update the key and retry this document.',
    })
  })

  it('preserves task failure for rejected platform embedding credentials', async () => {
    const platformError = new EmbeddingAPIError('Embedding API failed: 401', 401)
    mockProcessDocumentAsync.mockRejectedValue(platformError)

    await expect(runDocumentProcessing(WORKSPACE_PAYLOAD)).rejects.toBe(platformError)
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
    mockQuotaExhaustion(quotaError)

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
        processingQueueToken: 'knowledge-quota-document-1-request-1-1',
        processingQueuedAt: expect.any(String),
        quotaRetryCount: 1,
      }),
      expect.objectContaining({
        delay: expect.any(Date),
        idempotencyKey: 'knowledge-quota-document-1-request-1-1',
        region: 'us-east-1',
      })
    )
    const delay = mockTrigger.mock.calls[0]?.[2]?.delay as Date
    expect(delay.getTime()).toBeGreaterThanOrEqual(1_000 + EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 0.8)
    expect(delay.getTime()).toBeLessThanOrEqual(1_000 + EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 1.2)
  })

  it('continues provider pressure beyond the task retry budget without admitting another pass', async () => {
    const error = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 600_000 })
    mockProcessDocumentAsync.mockImplementation(async (...args: unknown[]) => {
      await (args[6] as DocumentProcessingAttemptContext).scheduleProviderContinuation!(error)
      throw error
    })
    const now = Date.now()
    await expect(
      runDocumentProcessing(
        {
          ...WORKSPACE_PAYLOAD,
          processingQueueToken: 'request-1',
          providerRetryCount: 3,
          providerRetryStartedAt: new Date(now).toISOString(),
        },
        3
      )
    ).resolves.toMatchObject({ outcome: 'provider_deferred' })
    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'request-1',
      expect.objectContaining({ chargedAtDispatch: false, processingQueueToken: 'request-1' })
    )
    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-process-document',
      expect.objectContaining({
        requestId: 'request-1',
        processingQueueToken: 'knowledge-provider-document-1-request-1-4',
        providerRetryCount: 4,
        billingAttribution: BILLING_ATTRIBUTION,
      }),
      expect.objectContaining({ idempotencyKey: 'knowledge-provider-document-1-request-1-4' })
    )
    expect((mockTrigger.mock.calls[0][2].delay as Date).getTime()).toBeGreaterThanOrEqual(
      now + 600_000
    )
  })

  it('reports provider recovery exhaustion as an actionable terminal outcome', async () => {
    mockProcessDocumentAsync.mockImplementation(async (...args: unknown[]) => {
      await (args[6] as DocumentProcessingAttemptContext).scheduleProviderContinuation!(
        new ProviderCapacityDeferredError('rate_limit')
      )
    })
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        providerRetryCount: MAX_PROVIDER_CONTINUATION_ATTEMPTS,
        providerRetryStartedAt: new Date().toISOString(),
      })
    ).resolves.toMatchObject({
      outcome: 'provider_exhausted',
      error: expect.stringContaining('then retry this document'),
    })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('retries failed provider continuation dispatch instead of reporting a successful deferral', async () => {
    const error = new Error('Trigger dispatch unavailable')
    mockTrigger.mockRejectedValue(error)
    mockProcessDocumentAsync.mockImplementation(async (...args: unknown[]) => {
      await (args[6] as DocumentProcessingAttemptContext).scheduleProviderContinuation!(
        new ProviderCapacityDeferredError('rate_limit')
      )
    })
    await expect(runDocumentProcessing(WORKSPACE_PAYLOAD)).rejects.toBe(error)
  })

  it('ends a quota chain after the bounded continuation horizon', async () => {
    mockQuotaExhaustion(new EmbeddingQuotaExhaustedError('openai'))

    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        quotaRetryCount: MAX_QUOTA_CONTINUATION_ATTEMPTS,
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      })
    ).resolves.toMatchObject({ success: false, outcome: 'quota_exhausted' })

    expect(mockTrigger).not.toHaveBeenCalled()
    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ quotaContinuationExhausted: true })
    )
  })

  it('keeps the task failed when the durable continuation handoff fails', async () => {
    mockQuotaExhaustion(new EmbeddingQuotaExhaustedError('openai'))
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
    mockQuotaExhaustion(new EmbeddingQuotaExhaustedError('openai'))

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
      expect.objectContaining({
        chargedAtDispatch: false,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
        scheduleQuotaContinuation: expect.any(Function),
      })
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
      expect.objectContaining({
        chargedAtDispatch: false,
        processingQueuedAt: new Date(BASE_PAYLOAD.processingQueuedAt),
        scheduleQuotaContinuation: expect.any(Function),
      })
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
    const first = resolveQuotaContinuationDelayMs(1)
    const second = resolveQuotaContinuationDelayMs(2)
    const capped = resolveQuotaContinuationDelayMs(Number.MAX_SAFE_INTEGER)

    expect(first).toBeGreaterThanOrEqual(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 0.8)
    expect(first).toBeLessThanOrEqual(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 1.2)
    expect(second).toBeGreaterThanOrEqual(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 2 * 0.8)
    expect(second).toBeLessThanOrEqual(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 2 * 1.2)
    expect(capped).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000 * 0.8)
    expect(capped).toBeLessThanOrEqual(6 * 60 * 60 * 1000)
  })
})
