import { HttpError } from '@/lib/core/utils/http-error'
import type { ToolResponse } from '@/tools/types'

const diagnosticFailures = new WeakSet<ToolResponse>()

/** Catch-generated HTTP diagnostics are not declared resource outputs. */
export function markToolDiagnosticFailure(response: ToolResponse): ToolResponse {
  diagnosticFailures.add(response)
  return response
}

export function isToolDiagnosticFailure(response: ToolResponse): boolean {
  return diagnosticFailures.has(response)
}

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
