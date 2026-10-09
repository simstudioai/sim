import type { Logger } from '@sim/logger'
import { findDatabaseQueryError } from '@/lib/core/errors/database-query-error'
import { isRetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import { HttpError } from '@/lib/core/utils/http-error'

/**
 * Who a failure is attributable to, which decides how loudly the server logs it. The user
 * sees every failure in full in the run log and trace spans regardless; this only governs
 * server log severity.
 *
 * - `user`: the workflow author's input, configuration, or code. Expected, logged at info.
 * - `third_party_client`: an external service rejected the request (4xx), usually because of
 *   the author's input or credentials. Logged at warn.
 * - `third_party_server`: an external service failed (5xx). Not ours to fix, and the server that
 *   produced the status owns the fault (Sim's own internal routes log their own 5xx), so warn.
 * - `internal`: Sim's own fault, or a cause nothing attributed. Always logged at error.
 */
export type FailureKind = 'user' | 'third_party_client' | 'third_party_server' | 'internal'

/** Mirrors the cause depth `describeError` and `readStatusCode` follow. */
const MAX_CAUSE_DEPTH = 8

/**
 * Side tables keyed by the thrown value, not properties on it: a thrown value may be frozen or
 * sealed, and identity keying adds nothing to a serialized error.
 */
const failureKinds = new WeakMap<object, FailureKind>()
const loggedFailures = new WeakSet<object>()

function isKeyable(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

/** The thrown value and each `cause` beneath it, outermost first. */
function causeChain(error: unknown): object[] {
  const chain: object[] = []
  let current = error
  while (isKeyable(current) && chain.length < MAX_CAUSE_DEPTH && !chain.includes(current)) {
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

/**
 * The flattened tool failure a block handler copies onto the error it throws. `executeTool`
 * turns a thrown failure into a `{ success: false, output }` result, so the handler's new error
 * shares only `output` with the failure the tool layer saw.
 */
function readToolFailureOutput(link: object): object | undefined {
  const output = (link as { output?: unknown }).output
  return isKeyable(output) ? output : undefined
}

/**
 * Upstream HTTP status of an external call: `status` on a transformed tool error, or on the
 * tool failure output a block handler copied. Never Sim's own `statusCode`.
 */
function readUpstreamStatus(link: object): number | undefined {
  const status = (link as { status?: unknown }).status
  if (typeof status === 'number' && status >= 400 && status < 600) return status
  const output = readToolFailureOutput(link) as { status?: unknown } | undefined
  const outputStatus = output?.status
  if (typeof outputStatus === 'number' && outputStatus >= 400 && outputStatus < 600) {
    return outputStatus
  }
  return undefined
}

/** Records who `error` is attributable to, overriding what its shape would imply. */
export function markFailureKind<T>(error: T, kind: FailureKind): T {
  if (isKeyable(error)) failureKinds.set(error, kind)
  return error
}

/**
 * Records `kind` only when `error` is a plain `Error` deliberately thrown with a message. A
 * `TypeError`, `RangeError`, or other subclass raised by a bug in the same code stays
 * unattributed, so it keeps logging at error.
 */
export function markDeliberateFailure<T>(error: T, kind: FailureKind): T {
  if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype) {
    failureKinds.set(error, kind)
  }
  return error
}

/**
 * Attributes `error` from its cause chain. A database failure anywhere is always internal,
 * then the outermost link with an explicit mark, a Sim `HttpError` status, or an upstream status
 * decides. Anything unattributed is internal.
 */
export function classifyFailure(error: unknown): FailureKind {
  if (findDatabaseQueryError(error)) return 'internal'

  for (const link of causeChain(error)) {
    if (isRetryableSetupError(link)) return 'internal'

    const output = readToolFailureOutput(link)
    const marked = failureKinds.get(link) ?? (output ? failureKinds.get(output) : undefined)
    if (marked) return marked

    if (link instanceof HttpError) {
      return link.statusCode >= 400 && link.statusCode < 500 ? 'user' : 'internal'
    }

    const upstreamStatus = readUpstreamStatus(link)
    if (upstreamStatus !== undefined) {
      return upstreamStatus >= 500 ? 'third_party_server' : 'third_party_client'
    }
  }

  return 'internal'
}

/**
 * Records that the boundary owning this failure has logged it. `subject` is the thrown value,
 * or the output of a flattened tool failure.
 */
export function markFailureLogged(subject: unknown): void {
  if (isKeyable(subject)) loggedFailures.add(subject)
}

/**
 * Whether any link of the cause chain, or the tool failure output a link carries, was already
 * logged. Survives `buildBlockExecutionError` and `ChildWorkflowError` (both keep `cause`), the
 * engine's identity-preserving rethrow, and a handler rebuilding a failed tool result as a new
 * error that carries the result's `output`.
 */
export function wasFailureLogged(error: unknown): boolean {
  return causeChain(error).some((link) => {
    if (loggedFailures.has(link)) return true
    const output = readToolFailureOutput(link)
    return output !== undefined && loggedFailures.has(output)
  })
}

const LOG_LEVEL_BY_KIND = {
  user: 'info',
  third_party_client: 'warn',
  third_party_server: 'warn',
  internal: 'error',
} as const satisfies Record<FailureKind, 'info' | 'warn' | 'error'>

/**
 * Logs a failure at the severity its cause earns, unless a boundary closer to the cause already
 * logged it, then marks it logged so every boundary it propagates through stays quiet.
 */
export function logFailureOnce(
  logger: Logger,
  message: string,
  error: unknown,
  metadata: Record<string, unknown> = {}
): void {
  if (wasFailureLogged(error)) return
  const failureKind = classifyFailure(error)
  logger[LOG_LEVEL_BY_KIND[failureKind]](message, { ...metadata, failureKind })
  markFailureLogged(error)
}
