import {
  ProviderAdmissionStorageError,
  ProviderAdmissionTimeoutError,
} from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import {
  getOcrRequestRejection,
  isPermanentDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'

/**
 * Reads typed capacity failures through OCR's aggregate wrappers. A caller abort
 * or deterministic document failure takes precedence over another chunk's throttle.
 */
export function getProviderCapacityDeferral(error: unknown): ProviderCapacityDeferredError | null {
  if (getOcrRequestRejection(error)) return null
  const pending = [error]
  const seen = new Set<unknown>()
  let deferred: ProviderCapacityDeferredError | null = null
  while (pending.length > 0) {
    const current = pending.pop()
    if (!(current instanceof Error) || seen.has(current)) continue
    seen.add(current)
    if (current.name === 'AbortError' || isPermanentDocumentProcessingError(current)) return null
    if ('quotaExhausted' in current && current.quotaExhausted === true) continue
    let candidate: ProviderCapacityDeferredError | null = null
    if (current instanceof ProviderCapacityDeferredError) {
      candidate = current
    } else if (current instanceof ProviderAdmissionTimeoutError) {
      candidate = new ProviderCapacityDeferredError('admission_timeout', {
        retryAfterMs: current.retryAfterMs,
        cause: current,
      })
    } else if (current instanceof ProviderAdmissionStorageError) {
      candidate = new ProviderCapacityDeferredError('admission_unavailable', { cause: current })
    } else if ('status' in current && current.status === 429) {
      candidate = new ProviderCapacityDeferredError('rate_limit', {
        ...('retryAfterMs' in current && typeof current.retryAfterMs === 'number'
          ? { retryAfterMs: current.retryAfterMs }
          : {}),
        cause: current,
      })
    }
    if (candidate && (!deferred || (candidate.retryAfterMs ?? 0) > (deferred.retryAfterMs ?? 0))) {
      deferred = candidate
    }
    if (current instanceof AggregateError) pending.push(...current.errors)
    if (
      current.cause !== undefined &&
      !(current instanceof ProviderCapacityDeferredError && current.reason === 'provider_timeout')
    )
      pending.push(current.cause)
  }
  return deferred
}

/** An actionable terminal state after a bounded, durable provider recovery window. */
export class ProviderCapacityContinuationExhaustedError extends Error {
  constructor() {
    super(
      'Automatic indexing paused because provider capacity did not recover within the retry window. Check the OCR or embedding provider quota and configured request limits, then retry this document.'
    )
    this.name = 'ProviderCapacityContinuationExhaustedError'
  }
}
