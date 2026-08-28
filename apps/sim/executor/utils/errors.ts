import { getErrorMessage } from '@sim/utils/errors'
import { HttpError } from '@/lib/core/utils/http-error'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

/**
 * Interface for errors that carry an ExecutionResult.
 * Used when workflow execution fails and we want to preserve partial results.
 */
export interface ErrorWithExecutionResult extends Error {
  executionResult: ExecutionResult
}

/**
 * Type guard to check if an error carries an ExecutionResult.
 * Validates that executionResult has required fields (success, output).
 */
export function hasExecutionResult(error: unknown): error is ErrorWithExecutionResult {
  if (
    !(error instanceof Error) ||
    !('executionResult' in error) ||
    error.executionResult == null ||
    typeof error.executionResult !== 'object'
  ) {
    return false
  }

  const result = error.executionResult as Record<string, unknown>
  return typeof result.success === 'boolean' && result.output != null
}

/**
 * Attaches an ExecutionResult to an error for propagation to parent workflows.
 */
export function attachExecutionResult(error: Error, executionResult: ExecutionResult): void {
  Object.assign(error, { executionResult })
}

/**
 * Dispatched-run ids, keyed by the thrown value itself.
 *
 * A side table rather than a property on the error, for the same reason
 * {@link markExecutionFinalizedByCore} keeps one: a thrown value is not reliably writable.
 * `Object.assign` throws on a frozen or sealed failure, and guarding that throw would drop
 * the marker instead — silently converting "this run exists" into "nothing started", which
 * is the one direction that duplicates work. Identity keying also means no id can arrive
 * through a prototype chain, and nothing is added to the error's own surface, so a
 * serialized error carries no stray field.
 */
const attemptedExecutionIds = new WeakMap<object, string>()

/**
 * Names the run a failure belongs to once dispatch has been attempted.
 *
 * A caller that only sees the thrown error cannot tell an authorization refusal — which
 * created nothing — from a crash after the run was already dispatched, and those need
 * opposite retry decisions. Recording the id at the point of no return makes its absence
 * mean "nothing was started" rather than "we do not know", and its presence a key that
 * resolves to zero or one executions.
 *
 * Distinct from {@link attachExecutionResult}: that says the workflow ran and produced a
 * result, this says only that it was dispatched.
 */
export function attachAttemptedExecutionId(error: unknown, executionId: string): void {
  if (!isRecordedThrown(error) || !executionId) return
  if (attemptedExecutionIds.has(error)) return
  attemptedExecutionIds.set(error, executionId)
}

/**
 * Whether a block handler ran, keyed by the outcome that carries it — a result or a throw.
 *
 * Recorded rather than inferred. Every property of an outcome that looks like it answers
 * this is a proxy that disagrees on the paths that matter: an engine failing before its
 * first block still carries an `ExecutionResult`, and a run that ends without one still ran
 * every block it had. Only the executor knows, so only the executor says.
 */
const observedBlockDispatch = new WeakMap<object, boolean>()

/** Records the executor's answer against the outcome a caller will read it from. */
export function recordBlocksMayHaveRun(outcome: unknown, blocksMayHaveRun: boolean): void {
  if (!isRecordedThrown(outcome)) return
  observedBlockDispatch.set(outcome, blocksMayHaveRun)
}

/** Undefined when nothing observed this run, which callers must treat conservatively. */
export function readBlocksMayHaveRun(outcome: unknown): boolean | undefined {
  return isRecordedThrown(outcome) ? observedBlockDispatch.get(outcome) : undefined
}

/** Reads the dispatched-run id a thrown value carries, if dispatch was reached at all. */
export function readAttemptedExecutionId(error: unknown): string | undefined {
  return isRecordedThrown(error) ? attemptedExecutionIds.get(error) : undefined
}

/**
 * Any non-null object, not only an `Error`.
 *
 * Restricting this to `Error` would silently invert the invariant for a thrown plain object:
 * no id would be recorded, its absence would read as "nothing was started", and the caller
 * would retry a run that already exists. A thrown primitive cannot be keyed at all, which
 * costs nothing today because every throw site past the dispatch boundary raises an `Error`.
 */
function isRecordedThrown(value: unknown): value is object {
  /** Functions key a WeakMap as well as objects do, so excluding them would drop the record. */
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

export interface BlockExecutionErrorDetails {
  block: SerializedBlock
  error: Error | string
  context?: ExecutionContext
  additionalInfo?: Record<string, any>
}

/**
 * Wraps a block failure with the block's identity. The original error is kept
 * as `cause` so the chain stays walkable — `readStatusCode` and `describeError`
 * both depend on it, and rebuilding the error without it severs the chain at
 * every block boundary.
 */
export function buildBlockExecutionError(details: BlockExecutionErrorDetails): Error {
  const errorMessage = getErrorMessage(details.error)
  const blockName = details.block.metadata?.name || details.block.id
  const blockType = details.block.metadata?.id || 'unknown'

  const error = new Error(`${blockName}: ${errorMessage}`, {
    cause: details.error instanceof Error ? details.error : undefined,
  })

  Object.assign(error, {
    blockId: details.block.id,
    blockName,
    blockType,
    workflowId: details.context?.workflowId,
    timestamp: new Date().toISOString(),
    ...details.additionalInfo,
  })

  return error
}

/** Maximum `.cause` links to follow before giving up. Mirrors `describeError`. */
const MAX_CAUSE_DEPTH = 8

/**
 * HTTP status carried by a thrown value, walking the `.cause` chain so a status
 * set deep in a tool survives the block-level wrapping that rebuilds the error.
 *
 * Reads only SIM-OWNED carriers: `HttpError.statusCode` (canonical) and the
 * `statusCode` field `generic-handler` re-attaches from a failed `ToolResponse`.
 * Deliberately does NOT read the duck-typed `status` field: that carries an
 * UPSTREAM target's status (`api-handler` copies it off the remote response, and
 * transformed HTTP tool errors carry it too). Adopting it would turn a remote
 * 404 into the workflow API's 404, colliding with the statuses that route owns
 * (404 = workflow not found, 401 = bad API key, 429 = Sim rate limit).
 */
export function readStatusCode(value: unknown): number | undefined {
  const seen = new Set<unknown>()
  let current = value

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error) || seen.has(current)) return undefined
    seen.add(current)

    if (current instanceof HttpError) return current.statusCode

    const candidate = current as unknown as { statusCode?: unknown }
    if (typeof candidate.statusCode === 'number') return candidate.statusCode

    current = current.cause
  }

  return undefined
}

/**
 * 5xx statuses that describe Sim's own capacity rather than an upstream
 * provider's, and are therefore safe to forward to the API caller. An
 * upstream 502/504 must not become the workflow API's status.
 */
const FORWARDABLE_SERVER_STATUSES = new Set([503])

/**
 * Maps an execution error to an HTTP status code. Errors thrown from the
 * executor that represent workflow-author mistakes (invalid field references,
 * etc.) carry a 4xx status; hosted-key exhaustion carries a 503. Everything
 * else is a 500.
 */
export function getExecutionErrorStatus(error: unknown): number {
  const status = readStatusCode(error)
  if (status === undefined) return 500
  if (status >= 400 && status < 500) return status
  if (FORWARDABLE_SERVER_STATUSES.has(status)) return status
  return 500
}

export function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Stable, append-only error classes for failed workflow executions. Callers
 * (v2 API consumers, parent workflows, MCP clients) route on these instead of
 * substring-matching messages; this module is the single place raw errors are
 * interpreted, so the executor can later attach codes natively at throw sites
 * without a wire change.
 *
 * Append-only binds what a caller can observe, and an oversize run response has
 * never been observable here: it is not an in-band failure at all. The execution
 * service short-circuits it into an HTTP 413 carrying `workflow_response_too_large`
 * in the error envelope, so no run ever reaches classification with an oversize
 * output. `OUTPUT_TOO_LARGE` was therefore a code no caller could ever have
 * routed on — publishing it only invited a branch that never runs, and an
 * exhaustive `switch` in a generated SDK to claim coverage it does not have.
 * Retiring an unreachable member narrows the published type without changing a
 * single response; adding a reachable member later is still the append-only path.
 */
export type WorkflowExecutionErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'BLOCK_EXECUTION_FAILED'
  | 'CHILD_WORKFLOW_FAILED'
  | 'EXECUTION_FAILED'

export interface StructuredExecutionError {
  message: string
  code: WorkflowExecutionErrorCode
  blockId?: string
  blockName?: string
  blockType?: string
}

interface AttachedBlockContext {
  blockId?: unknown
  blockName?: unknown
  blockType?: unknown
}

function readAttachedBlockContext(error: unknown): {
  blockId?: string
  blockName?: string
  blockType?: string
} {
  if (!(error instanceof Error)) return {}
  const attached = error as unknown as AttachedBlockContext
  return {
    blockId: typeof attached.blockId === 'string' ? attached.blockId : undefined,
    blockName: typeof attached.blockName === 'string' ? attached.blockName : undefined,
    blockType: typeof attached.blockType === 'string' ? attached.blockType : undefined,
  }
}

function lastFailedBlockLog(result: ExecutionResult | undefined): {
  blockId?: string
  blockName?: string
  blockType?: string
  error?: string
} {
  const logs = result?.logs
  if (!logs?.length) return {}
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i]
    if (!log.success && log.errorHandled !== true) {
      return {
        blockId: log.blockId,
        blockName: log.blockName,
        blockType: log.blockType,
        error: log.error,
      }
    }
  }
  return {}
}

const CHILD_WORKFLOW_BLOCK_TYPES = new Set(['workflow', 'workflow_input'])

/**
 * Classifies a failed execution into {@link StructuredExecutionError}.
 * Block context comes from the fields {@link buildBlockExecutionError} already
 * attaches at the throw site, falling back to the last failed, un-handled
 * `BlockLog`. The message drops the historical `"BlockName: "` prefix once
 * `blockName` is carried as its own field.
 */
export function classifyExecutionError(
  error: unknown,
  result?: ExecutionResult
): StructuredExecutionError {
  const executionResult = result ?? (hasExecutionResult(error) ? error.executionResult : undefined)
  const attached = readAttachedBlockContext(error)
  const fromLog = lastFailedBlockLog(executionResult)
  const blockId = attached.blockId ?? fromLog.blockId
  const blockName = attached.blockName ?? fromLog.blockName
  const blockType = attached.blockType ?? fromLog.blockType

  let message =
    (error instanceof Error ? error.message : undefined) ??
    executionResult?.error ??
    fromLog.error ??
    'Execution failed'
  if (blockName && message.startsWith(`${blockName}: `)) {
    message = message.slice(blockName.length + 2)
  }

  const statusCode = error instanceof Error ? getExecutionErrorStatus(error) : undefined
  let code: WorkflowExecutionErrorCode
  if (statusCode === 408 || /\btimed? ?out\b/i.test(message)) {
    code = 'TIMEOUT'
  } else if (statusCode === 402 || /usage limit/i.test(message)) {
    code = 'USAGE_LIMIT_EXCEEDED'
  } else if (executionResult?.status === 'cancelled' || /\bcancelled\b/i.test(message)) {
    code = 'CANCELLED'
  } else if (/invalid input format/i.test(message)) {
    code = 'INVALID_INPUT'
  } else if (blockType && CHILD_WORKFLOW_BLOCK_TYPES.has(blockType)) {
    code = 'CHILD_WORKFLOW_FAILED'
  } else if (blockId) {
    code = 'BLOCK_EXECUTION_FAILED'
  } else {
    code = 'EXECUTION_FAILED'
  }

  return { message, code, blockId, blockName, blockType }
}
