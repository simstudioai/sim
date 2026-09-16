/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  ProviderAdmissionStorageError,
  ProviderAdmissionTimeoutError,
} from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EmbeddingAPIError, EmbeddingQuotaExhaustedError } from '@/lib/embeddings/client'
import {
  OcrRequestRejectedError,
  PermanentDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import { getProviderCapacityDeferral } from '@/lib/knowledge/documents/processing-provider-deferral'

describe('provider capacity deferral classification', () => {
  it('distinguishes a known provider timeout from a sibling caller cancellation', () => {
    const timeout = new ProviderCapacityDeferredError('provider_timeout', {
      cause: new DOMException('Transport aborted by its own deadline', 'AbortError'),
    })
    expect(getProviderCapacityDeferral(timeout)).toBe(timeout)
    expect(
      getProviderCapacityDeferral(
        new AggregateError([timeout, new DOMException('Caller cancelled', 'AbortError')])
      )
    ).toBeNull()
  })
  it('retains the longest wait through nested OCR failures and cyclic causes', () => {
    const shorter = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 60_000 })
    const longer = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 600_000 })
    const wrapper = new Error('OCR incomplete', { cause: new AggregateError([shorter, longer]) })
    shorter.cause = wrapper
    expect(getProviderCapacityDeferral(wrapper)).toBe(longer)
  })

  it.each([
    [new ProviderAdmissionTimeoutError(), 'admission_timeout'],
    [new ProviderAdmissionStorageError(new Error('Redis unavailable')), 'admission_unavailable'],
    [new EmbeddingAPIError('Too many requests', 429), 'rate_limit'],
  ])('classifies typed infrastructure pressure: %s', (error, reason) => {
    expect(getProviderCapacityDeferral(error)?.reason).toBe(reason)
  })

  it.each([
    new DOMException('Caller cancelled', 'AbortError'),
    new PermanentDocumentProcessingError('invalid_file', 'Replace this file'),
    new OcrRequestRejectedError(400),
  ])('lets cancellation or bad document bytes win over sibling throttles', (error) => {
    expect(
      getProviderCapacityDeferral(
        new AggregateError([error, new ProviderCapacityDeferredError('rate_limit')])
      )
    ).toBeNull()
  })

  it.each([
    new Error('Rate limit text alone is not evidence'),
    new DOMException('Unknown timeout', 'TimeoutError'),
    new EmbeddingAPIError('Unauthorized', 401),
    new EmbeddingQuotaExhaustedError('openai'),
  ])('leaves unrelated failures and the existing quota policy intact: %s', (error) => {
    expect(getProviderCapacityDeferral(error)).toBeNull()
  })
})
