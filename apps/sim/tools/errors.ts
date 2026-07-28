import { HttpError } from '@/lib/core/utils/http-error'

/**
 * Hosted-key acquisition blocked by the workspace's own rate bucket. Carries a
 * 429 so the status survives block-level wrapping and reaches the API caller
 * instead of being flattened to a generic 500.
 */
export class HostedKeyRateLimitedError extends HttpError {
  readonly statusCode = 429

  constructor(
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'HostedKeyRateLimitedError'
  }
}

/** No hosted keys are configured or available for this provider. */
export class HostedKeyUnavailableError extends HttpError {
  readonly statusCode = 503

  constructor(message: string) {
    super(message)
    this.name = 'HostedKeyUnavailableError'
  }
}
