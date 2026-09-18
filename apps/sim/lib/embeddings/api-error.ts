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

/** Finds an embedding failure through bounded aggregate/cause wrappers. */
export function getEmbeddingAPIError(error: unknown): EmbeddingAPIError | null {
  const pending = [error]
  const seen = new Set<unknown>()
  while (pending.length > 0 && seen.size < 32) {
    const current = pending.pop()
    if (!(current instanceof Error) || seen.has(current)) continue
    seen.add(current)
    if (current instanceof EmbeddingAPIError) return current
    if (current.cause !== undefined) pending.push(current.cause)
    if (current instanceof AggregateError) pending.push(...current.errors.slice(0, 32))
  }
  return null
}
