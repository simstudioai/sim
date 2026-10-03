export type ProviderCapacityDeferralReason =
  | 'rate_limit'
  | 'admission_timeout'
  | 'admission_unavailable'
  | 'provider_timeout'
  | 'processing_budget'

interface ProviderCapacityDeferralOptions {
  readonly providerId?: string
  readonly retryAfterMs?: number
  readonly cause?: unknown
}

/** Capacity waits leave the request retry loop and resume through durable ingestion scheduling. */
export class ProviderCapacityDeferredError extends Error {
  readonly retryable = false
  readonly providerId?: string
  readonly retryAfterMs?: number

  constructor(
    readonly reason: ProviderCapacityDeferralReason,
    options: ProviderCapacityDeferralOptions = {}
  ) {
    super('Document processing is waiting for provider capacity', { cause: options.cause })
    this.name = 'ProviderCapacityDeferredError'
    this.providerId = options.providerId
    this.retryAfterMs =
      options.retryAfterMs !== undefined &&
      Number.isFinite(options.retryAfterMs) &&
      options.retryAfterMs > 0
        ? options.retryAfterMs
        : undefined
  }
}
