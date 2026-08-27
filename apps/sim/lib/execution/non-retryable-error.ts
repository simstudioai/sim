import { findCause, getErrorMessage } from '@sim/utils/errors'

/** A failure whose operation may already have produced externally visible side effects. */
export class NonRetryableExecutionError extends Error {
  readonly retryable = false as const

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NonRetryableExecutionError'
  }
}

/** The provider may have started user code but did not return a recoverable process identity. */
export class SandboxLaunchIndeterminateError extends NonRetryableExecutionError {
  readonly code = 'sandbox_launch_indeterminate' as const

  constructor(provider: string, options?: ErrorOptions) {
    const providerDetail = options?.cause
      ? ` Provider detail: ${getErrorMessage(options.cause)}`
      : ''
    super(
      `${provider} may have started this Function, but Sim could not recover its process identity. The outcome is indeterminate and the code was not run again.${providerDetail}`,
      options
    )
    this.name = 'SandboxLaunchIndeterminateError'
  }
}

export function isNonRetryableExecutionError(error: unknown): boolean {
  return Boolean(
    findCause(error, (cause): cause is NonRetryableExecutionError => {
      return (
        cause instanceof NonRetryableExecutionError ||
        (typeof cause === 'object' &&
          cause !== null &&
          'retryable' in cause &&
          cause.retryable === false)
      )
    })
  )
}

export function isSandboxLaunchIndeterminateError(
  error: unknown
): error is SandboxLaunchIndeterminateError {
  return Boolean(findCause(error, (cause) => cause instanceof SandboxLaunchIndeterminateError))
}
