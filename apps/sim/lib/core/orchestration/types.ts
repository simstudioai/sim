export type OrchestrationErrorCode =
  | 'validation'
  /**
   * The credentials this operation depends on are no longer usable — a stored
   * third-party token that will not refresh, not an unauthenticated caller.
   * Distinct from `forbidden`, which is the caller lacking permission.
   */
  | 'unauthorized'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'locked'
  | 'payload_too_large'
  | 'internal'

/**
 * Transport-neutral failure classes returned by every `lib/[resource]/orchestration`
 * module, so the UI routes, the public API, and the copilot tools map the same
 * failure to the same status.
 */
export function statusForOrchestrationError(code: OrchestrationErrorCode | undefined): number {
  if (code === 'validation') return 400
  if (code === 'unauthorized') return 401
  if (code === 'forbidden') return 403
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  if (code === 'locked') return 423
  if (code === 'payload_too_large') return 413
  return 500
}

/**
 * The message a JSON route should render for an orchestration failure.
 *
 * A classified failure is caller-fixable, so its message is written for the
 * caller and is safe to return. An unclassified one carries whatever text the
 * fault happened to have — a driver's failed SQL, say — so the caller gets the
 * route's own generic wording instead. `v2ErrorForOrchestration` applies the
 * same rule for the v2 envelope.
 */
export function messageForOrchestrationError(
  result: { error?: string; errorCode?: OrchestrationErrorCode },
  fallback: string
): string {
  if (!result.errorCode || result.errorCode === 'internal') return fallback
  return result.error ?? fallback
}

/**
 * A domain failure that already knows its own class.
 *
 * Services throw this instead of a bare `Error` whenever the failure is
 * caller-fixable, so the layers above classify by `instanceof` and read `code`
 * rather than searching the message for a phrase. Message text is then free to
 * be reworded, translated, or made more specific without silently changing the
 * status every caller returns — the failure mode this replaced, where adding
 * "already exists" to a message demoted a 409 to a 400.
 *
 * The code is transport-neutral on purpose: `statusForOrchestrationError` maps
 * it for the UI and v1 routes, `v2ErrorForOrchestration` maps it to the v2
 * error vocabulary, and the copilot tools surface `message` with no status at
 * all. An anything-else error stays unclassified and becomes a generic 500,
 * which is what an unexpected fault should be.
 */
export class OrchestrationError extends Error {
  constructor(
    readonly code: OrchestrationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OrchestrationError'
  }
}

/**
 * Rethrows a failed orchestration result as its classified {@link OrchestrationError}.
 *
 * Pairs the code with the message {@link messageForOrchestrationError} permits for
 * it, so the two can never disagree. Hand-rolling that pair is what let raw driver
 * text reach clients: a site that defaulted the code with `?? 'internal'` but then
 * compared the *raw* `errorCode` against `'internal'` classified an uncoded failure
 * as internal while still rendering its own message.
 */
export function throwOrchestrationFailure(
  result: { error?: string; errorCode?: OrchestrationErrorCode },
  fallback: string
): never {
  throw new OrchestrationError(
    result.errorCode ?? 'internal',
    messageForOrchestrationError(result, fallback)
  )
}

/**
 * The {@link OrchestrationError} in `error`'s cause chain, or `null` when the
 * failure is not a classified one.
 *
 * Walks `cause` rather than testing `error` alone because drizzle wraps a throw
 * raised inside a transaction callback in a `DrizzleQueryError` whose own
 * message is the failed SQL — the same reason the message-matching this
 * replaced had to dig for a root cause before it could classify anything.
 */
export function asOrchestrationError(error: unknown): OrchestrationError | null {
  let current: unknown = error
  while (current instanceof Error) {
    if (current instanceof OrchestrationError) return current
    current = current.cause
  }
  return null
}

/** Transport metadata available to an application operation for audit capture. */
export interface OrchestrationRequestContext {
  headers: { get(name: string): string | null }
}
