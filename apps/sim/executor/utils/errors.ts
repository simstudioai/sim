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

export function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
