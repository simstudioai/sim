import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('@/lib/knowledge/documents/processing-continuation-dispatch', () => ({
  dispatchDocumentProcessingContinuation: dispatch,
}))

import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import {
  assertDocumentProcessingPayload,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'
import {
  MAX_PROVIDER_CONTINUATION_AGE_MS,
  MAX_PROVIDER_CONTINUATION_ATTEMPTS,
  scheduleDocumentProcessingProviderContinuation,
} from '@/lib/knowledge/documents/processing-provider-continuation'
import { ProviderCapacityContinuationExhaustedError } from '@/lib/knowledge/documents/processing-provider-deferral'

const NOW = new Date('2026-09-08T12:00:00.000Z')
const PAYLOAD: DocumentProcessingPayload = {
  knowledgeBaseId: 'kb-1',
  documentId: 'doc-1',
  requestId: 'pass-1',
  processingQueueToken: 'pass-1',
  processingQueuedAt: NOW.toISOString(),
  docData: { filename: 'scan.pdf', fileUrl: 'scan.pdf', fileSize: 1, mimeType: 'application/pdf' },
  processingOptions: {},
  billingScope: 'non-workspace',
  workspaceId: null,
  actorUserId: 'user-1',
}

describe('durable provider continuations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    dispatch.mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('respects a Retry-After beyond the ordinary polling cap while retaining the pass', async () => {
    const delay = 2 * 60 * 60 * 1000
    const continuation = await scheduleDocumentProcessingProviderContinuation(
      PAYLOAD,
      new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: delay })
    )
    const due = continuation.deferredUntil
    expect(continuation.processingQueueToken).toBe('knowledge-provider-doc-1-pass-1-1')
    expect(due.getTime()).toBe(NOW.getTime() + delay)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'pass-1',
        processingQueueToken: 'knowledge-provider-doc-1-pass-1-1',
        processingQueuedAt: due.toISOString(),
        providerRetryCount: 1,
        providerRetryStartedAt: NOW.toISOString(),
      }),
      due,
      'knowledge-provider-doc-1-pass-1-1',
      undefined
    )
  })

  it.each(['attempts', 'age', 'provider wait'] as const)(
    'ends an exhausted %s window without scheduling an early request',
    async (limit) => {
      const payload = {
        ...PAYLOAD,
        providerRetryCount: limit === 'attempts' ? MAX_PROVIDER_CONTINUATION_ATTEMPTS : 1,
        providerRetryStartedAt: new Date(
          NOW.getTime() - (limit === 'age' ? MAX_PROVIDER_CONTINUATION_AGE_MS : 0)
        ).toISOString(),
      }
      await expect(
        scheduleDocumentProcessingProviderContinuation(
          payload,
          new ProviderCapacityDeferredError('rate_limit', {
            retryAfterMs:
              limit === 'provider wait' ? MAX_PROVIDER_CONTINUATION_AGE_MS + 1 : undefined,
          })
        )
      ).rejects.toBeInstanceOf(ProviderCapacityContinuationExhaustedError)
      expect(dispatch).not.toHaveBeenCalled()
    }
  )

  it('resumes healthy checkpointed progress promptly without consuming provider failure attempts', async () => {
    const payload = {
      ...PAYLOAD,
      providerRetryCount: 2,
      processingSliceCount: 100,
      providerRetryStartedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    }
    const continuation = await scheduleDocumentProcessingProviderContinuation(
      payload,
      new ProviderCapacityDeferredError('processing_budget'),
      false
    )
    expect(continuation.deferredUntil.getTime()).toBe(NOW.getTime() + 1000)
    expect(continuation.processingQueueToken).toBe('knowledge-slice-doc-1-pass-1-101')
    expect(assertDocumentProcessingPayload(dispatch.mock.calls[0][0])).toMatchObject({
      providerRetryCount: 2,
      processingSliceCount: 101,
      providerRetryStartedAt: payload.providerRetryStartedAt,
    })
  })

  it('resumes soon after the local admission bucket turned a batch away, without spending a provider attempt', async () => {
    const payload = {
      ...PAYLOAD,
      providerRetryCount: 2,
      processingSliceCount: 7,
      providerRetryStartedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    }
    const continuation = await scheduleDocumentProcessingProviderContinuation(
      payload,
      new ProviderCapacityDeferredError('admission_timeout', { retryAfterMs: 3_000 }),
      false
    )
    const delay = continuation.deferredUntil.getTime() - NOW.getTime()
    expect(delay).toBeGreaterThanOrEqual(8_000)
    expect(delay).toBeLessThanOrEqual(12_000)
    expect(continuation.processingQueueToken).toBe('knowledge-slice-doc-1-pass-1-8')
    expect(assertDocumentProcessingPayload(dispatch.mock.calls[0][0])).toMatchObject({
      providerRetryCount: 2,
      processingSliceCount: 8,
      providerRetryStartedAt: payload.providerRetryStartedAt,
    })
  })

  it('keeps the exponential ladder for provider-side throttling', async () => {
    const continuation = await scheduleDocumentProcessingProviderContinuation(
      { ...PAYLOAD, providerRetryCount: 3 },
      new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 3_000 }),
      false
    )
    const delay = continuation.deferredUntil.getTime() - NOW.getTime()
    expect(delay).toBeGreaterThanOrEqual(8 * 60_000 * 0.8)
    expect(continuation.processingQueueToken).toBe('knowledge-provider-doc-1-pass-1-4')
  })

  it('uses the same generation when a handoff is replayed after its acknowledgement was lost', async () => {
    const error = new ProviderCapacityDeferredError('admission_unavailable')
    const first = await scheduleDocumentProcessingProviderContinuation(PAYLOAD, error, false)
    vi.advanceTimersByTime(30_000)
    const replay = await scheduleDocumentProcessingProviderContinuation(PAYLOAD, error, false)
    expect(replay.processingQueueToken).toBe(first.processingQueueToken)
    expect(replay.deferredUntil).not.toEqual(first.deferredUntil)
    expect(dispatch.mock.calls[0][0].processingQueueToken).toBe(
      dispatch.mock.calls[1][0].processingQueueToken
    )
  })

  it('does not hide a failed durable handoff', async () => {
    const error = new Error('Outbox database unavailable')
    dispatch.mockRejectedValue(error)
    await expect(
      scheduleDocumentProcessingProviderContinuation(
        PAYLOAD,
        new ProviderCapacityDeferredError('admission_unavailable')
      )
    ).rejects.toBe(error)
  })
})
