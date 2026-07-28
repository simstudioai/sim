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
  const errorMessage =
    details.error instanceof Error ? details.error.message : String(details.error)
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
 * Reads `HttpError.statusCode` (the canonical class-based carrier) plus the
 * legacy duck-typed `statusCode`/`status` fields some paths still set.
 */
export function readStatusCode(value: unknown): number | undefined {
  const seen = new Set<unknown>()
  let current = value

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error) || seen.has(current)) return undefined
    seen.add(current)

    if (current instanceof HttpError) return current.statusCode

    const candidate = current as unknown as { statusCode?: unknown; status?: unknown }
    if (typeof candidate.statusCode === 'number') return candidate.statusCode
    if (typeof candidate.status === 'number') return candidate.status

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
