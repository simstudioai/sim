export type OrchestrationErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'locked'
  | 'internal'

/**
 * Transport-neutral failure classes returned by every `lib/[resource]/orchestration`
 * module, so the UI routes, the public API, and the copilot tools map the same
 * failure to the same status.
 */
export function statusForOrchestrationError(code: OrchestrationErrorCode | undefined): number {
  if (code === 'validation') return 400
  if (code === 'forbidden') return 403
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  if (code === 'locked') return 423
  return 500
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

/**
 * The slice of an HTTP request the audit log reads for client IP and user-agent
 * capture. Optional on every orchestration function so the non-HTTP callers —
 * copilot tools, background jobs — can omit what they do not have.
 */
export interface OrchestrationRequestContext {
  headers: { get(name: string): string | null }
}
