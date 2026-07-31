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

export function buildBlockExecutionError(details: BlockExecutionErrorDetails): Error {
  const errorMessage =
    details.error instanceof Error ? details.error.message : String(details.error)
  const blockName = details.block.metadata?.name || details.block.id
  const blockType = details.block.metadata?.id || 'unknown'

  const error = new Error(`${blockName}: ${errorMessage}`)

  const innerStatusCode = readStatusCode(details.error)

  Object.assign(error, {
    blockId: details.block.id,
    blockName,
    blockType,
    workflowId: details.context?.workflowId,
    timestamp: new Date().toISOString(),
    ...details.additionalInfo,
    ...(innerStatusCode !== undefined ? { statusCode: innerStatusCode } : {}),
  })

  return error
}

export function buildHTTPError(config: {
  status: number
  url?: string
  method?: string
  message?: string
}): Error {
  let errorMessage = config.message || `HTTP ${config.method || 'request'} failed`

  if (config.url) {
    errorMessage += ` - ${config.url}`
  }

  if (config.status) {
    errorMessage += ` (Status: ${config.status})`
  }

  const error = new Error(errorMessage)

  Object.assign(error, {
    status: config.status,
    url: config.url,
    method: config.method,
    timestamp: new Date().toISOString(),
  })

  return error
}

function readStatusCode(value: unknown): number | undefined {
  if (!(value instanceof Error)) return undefined
  const status = (value as unknown as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : undefined
}

/**
 * Maps an execution error to an HTTP status code. Errors thrown from the
 * executor that represent workflow-author mistakes (invalid field references,
 * etc.) carry a 4xx `statusCode`; everything else is a 500.
 */
export function getExecutionErrorStatus(error: unknown): number {
  const status = readStatusCode(error)
  if (status !== undefined && status >= 400 && status < 500) {
    return status
  }
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
 */
export type WorkflowExecutionErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'BLOCK_EXECUTION_FAILED'
  | 'CHILD_WORKFLOW_FAILED'
  | 'OUTPUT_TOO_LARGE'
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
