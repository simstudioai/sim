import { generateRandomString } from '@sim/utils/random'
import type { ExecutionContext } from '../types'

/**
 * Options for creating a mock execution context.
 */
interface ExecutionContextFactoryOptions {
  workflowId?: string
  executionId?: string
  blockStates?: Map<string, any>
  executedBlocks?: Set<string>
  blockLogs?: any[]
  metadata?: {
    duration?: number
    startTime?: string
    endTime?: string
  }
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  abortSignal?: AbortSignal
}

/**
 * Creates a mock execution context for testing workflow execution.
 *
 * @example
 * ```ts
 * const ctx = createExecutionContext({ workflowId: 'test-wf' })
 *
 * // With abort signal
 * const ctx = createExecutionContext({
 *   workflowId: 'test-wf',
 *   abortSignal: AbortSignal.abort(),
 * })
 * ```
 */
export function createExecutionContext(
  options: ExecutionContextFactoryOptions = {}
): ExecutionContext {
  return {
    workflowId: options.workflowId ?? 'test-workflow',
    executionId: options.executionId ?? `exec-${generateRandomString(8)}`,
    blockStates: options.blockStates ?? new Map(),
    executedBlocks: options.executedBlocks ?? new Set(),
    blockLogs: options.blockLogs ?? [],
    metadata: {
      duration: options.metadata?.duration ?? 0,
      startTime: options.metadata?.startTime ?? new Date().toISOString(),
      endTime: options.metadata?.endTime,
    },
    environmentVariables: options.environmentVariables ?? {},
    workflowVariables: options.workflowVariables ?? {},
    decisions: {
      router: new Map(),
      condition: new Map(),
    },
    loopExecutions: new Map(),
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    abortSignal: options.abortSignal,
  }
}
