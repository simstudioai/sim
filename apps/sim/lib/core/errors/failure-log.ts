import type { Logger } from '@sim/logger'
import { findDatabaseQueryError } from '@/lib/core/errors/database-query-error'
import { isRetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import { UserFailure } from '@/lib/core/errors/user-failure'
import { HttpError } from '@/lib/core/utils/http-error'

/**
 * Who a failure is attributable to, which decides how loudly the server logs it. The user
 * sees every failure in full in the run log and trace spans regardless; this only governs
 * server log severity.
 *
 * - `user`: the workflow author's input, configuration, or code. Expected, logged at info.
 * - `third_party_client`: an external service rejected the request (4xx), usually because of
 *   the author's input or credentials. Logged at warn.
 * - `third_party_server`: an external service failed (5xx). Not Sim's to fix, so warn. Sim's own
 *   in-process operations are attributed explicitly at their boundary and never land here.
 * - `internal`: Sim's own fault, or a cause nothing attributed. Always logged at error.
 */
export type FailureKind = 'user' | 'third_party_client' | 'third_party_server' | 'internal'

/** Mirrors the cause depth `describeError` and `readStatusCode` follow. */
const MAX_CAUSE_DEPTH = 8

/**
 * Side tables keyed by identity, not properties on the value: a thrown value may be frozen or
 * sealed, and identity keying adds nothing to a serialized error.
 *
 * `loggedCarriers` holds only values created during the propagation they describe (a flattened
 * tool failure's output, a block error, a handler's rebuilt error), never a raw thrown value: a
 * persistent fault can rethrow one object forever (a rejected dynamic `import()`, a memoized
 * rejected promise), and marking it would silence every later occurrence process-wide.
 * `loggedInExecution` scopes a raw value's mark to the one execution that logged it.
 */
const failureKinds = new WeakMap<object, FailureKind>()
const loggedCarriers = new WeakSet<object>()
const loggedInExecution = new WeakMap<object, string>()

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

/** Records who `error` is attributable to, overriding what its shape would imply. */
export function markFailureKind<T>(error: T, kind: FailureKind): T {
  if (isKeyable(error)) failureKinds.set(error, kind)
  return error
}

/**
 * Attributes `error` from its cause chain. A database failure anywhere is always internal,
 * then the outermost link with an explicit mark, a {@link UserFailure}, a Sim `HttpError` status,
 * or an upstream `status` decides. Anything unattributed is internal.
 */
export function classifyFailure(error: unknown): FailureKind {
  if (findDatabaseQueryError(error)) return 'internal'

  for (const link of causeChain(error)) {
    if (isRetryableSetupError(link)) return 'internal'

    const marked = failureKinds.get(link)
    if (marked) return marked
    if (link instanceof UserFailure) return 'user'

    if (link instanceof HttpError) {
      return link.statusCode >= 400 && link.statusCode < 500 ? 'user' : 'internal'
    }

    const status = (link as { status?: unknown }).status
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return status >= 500 ? 'third_party_server' : 'third_party_client'
    }
  }

  return 'internal'
}

/**
 * Records that the boundary owning a failure logged it, on a value created during this
 * propagation (see `loggedCarriers`). Never pass a raw thrown value.
 */
export function markFailureLogged(carrier: unknown): void {
  if (isKeyable(carrier)) loggedCarriers.add(carrier)
}

/**
 * Carries `source`'s marks onto `target`, a fresh error built at a boundary that drops `cause`:
 * the logged mark when `source` was logged, and `source`'s attribution unless `target` has its own.
 */
export function inheritFailureMarks<T>(target: T, source: unknown): T {
  if (!isKeyable(target)) return target
  if (wasFailureLogged(source)) loggedCarriers.add(target)
  if (!failureKinds.has(target)) failureKinds.set(target, classifyFailure(source))
  return target
}

/**
 * Carries a failed tool result's marks onto the error a handler rebuilds from it. `executeTool`
 * flattens a thrown failure into `{ success: false, output }`, logs it once, and marks `output`;
 * without this, the handler's fresh error looks unlogged and is logged again at error.
 */
export function adoptToolFailure<T>(error: T, result: { output?: unknown }): T {
  const output = result.output
  return isKeyable(output) && loggedCarriers.has(output)
    ? inheritFailureMarks(error, output)
    : error
}

/**
 * Whether a boundary already logged this failure: a logged carrier anywhere in the cause chain,
 * or, given `executionId`, a raw value that boundary logged during this same execution.
 */
export function wasFailureLogged(error: unknown, executionId?: string): boolean {
  return causeChain(error).some(
    (link) =>
      loggedCarriers.has(link) ||
      (executionId !== undefined && loggedInExecution.get(link) === executionId)
  )
}

const LOG_LEVEL_BY_KIND = {
  user: 'info',
  third_party_client: 'warn',
  third_party_server: 'warn',
  internal: 'error',
} as const satisfies Record<FailureKind, 'info' | 'warn' | 'error'>

interface LogFailureOptions {
  /** Built only when the line is logged, so a skipped boundary does no projection work. */
  metadata?: Record<string, unknown> | (() => Record<string, unknown>)
  /**
   * Set at execution-level boundaries (engine, execution core, trigger surfaces): the raw value is
   * marked for this execution only, and the id is added to the line. Below that level the caller
   * marks the fresh carrier it throws with {@link markFailureLogged}.
   */
  executionId?: string
}

/**
 * Logs a failure at the severity its cause earns unless a boundary closer to the cause already
 * logged it. Returns the attribution it logged with, or `undefined` when it skipped.
 */
export function logFailureOnce(
  logger: Logger,
  message: string,
  error: unknown,
  { metadata, executionId }: LogFailureOptions = {}
): FailureKind | undefined {
  if (wasFailureLogged(error, executionId)) return undefined
  const failureKind = classifyFailure(error)
  const fields = typeof metadata === 'function' ? metadata() : metadata
  logger[LOG_LEVEL_BY_KIND[failureKind]](message, {
    ...(executionId !== undefined ? { executionId } : {}),
    ...fields,
    failureKind,
  })
  if (executionId !== undefined && isKeyable(error)) loggedInExecution.set(error, executionId)
  return failureKind
}
