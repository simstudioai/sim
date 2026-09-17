export class EmbeddingAPIError extends Error {
  public status: number

  /** True when the rejected request used a customer-managed credential. */
  public readonly isBYOK: boolean

  /** Rejected for an exhausted balance rather than a recoverable rate limit. */
  public quotaExhausted?: boolean

  /**
   * Wait the provider asked for, read from the rejected response. Consumed by
   * {@link retryWithExponentialBackoff}, which prefers it over its own backoff.
   */
  public retryAfterMs?: number

  constructor(message: string, status: number, isBYOK = false) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
    this.isBYOK = isBYOK
  }
}
