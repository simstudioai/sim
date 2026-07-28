/**
 * Machine-readable class of a custom-block failure. Every member describes a
 * fact the CONSUMER already knows or can act on — never the source workflow's
 * blocks, tools, or upstream provider responses.
 */
export type CustomBlockErrorType =
  | 'missing_inputs'
  | 'not_deployed'
  | 'unavailable'
  | 'depth_limit'
  | 'execution_failed'

/** What a failed custom block tells its consumer. Leaks nothing about the source run. */
export interface CustomBlockFailure {
  /** Stable, machine-readable class of the failure. */
  errorType: CustomBlockErrorType
  /** Opaque handle to the child run, so the publisher can find the exact failing execution. */
  ref?: string
  /** Consumer-safe sentence. Generic unless the throw site was a {@link BoundarySafeError}. */
  message: string
}

/**
 * An error whose `message` names only the CALLER's own artifacts — the block
 * they placed, its input labels, its deployment state — so it may cross an
 * invocation boundary verbatim.
 *
 * Every error that is NOT of this class is opaque at the boundary. The default
 * is fail-closed, so a `throw new Error(...)` added later anywhere in the
 * custom-block path is redacted without anyone remembering to redact it. This
 * replaces the older convention of throwing *before* the `try` block to dodge
 * the catch's sanitizer, where redaction depended on lexical position.
 */
export class BoundarySafeError extends Error {
  readonly errorType: CustomBlockErrorType

  constructor(options: { message: string; errorType: CustomBlockErrorType }) {
    super(options.message)
    this.name = 'BoundarySafeError'
    this.errorType = options.errorType
  }
}

export function isBoundarySafeError(error: unknown): error is BoundarySafeError {
  return error instanceof BoundarySafeError
}
