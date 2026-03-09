import type { ExecutionContext } from '../types'

/**
 * Options for creating a mock execution context.
 */
export interface ExecutionContextFactoryOptions {
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
    executionId: options.executionId ?? `exec-${Math.random().toString(36).substring(2, 10)}`,
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

/**
 * Creates an execution context with pre-populated block states.
 *
 * @example
 * ```ts
 * const ctx = createExecutionContextWithStates({
 *   'block-1': { output: 'hello' },
 *   'block-2': { output: 'world' },
 * })
 * ```
 */
export function createExecutionContextWithStates(
  blockStates: Record<string, any>,
  options: Omit<ExecutionContextFactoryOptions, 'blockStates'> = {}
): ExecutionContext {
  const stateMap = new Map(Object.entries(blockStates))
  return createExecutionContext({
    ...options,
    blockStates: stateMap,
  })
}

/**
 * Creates an execution context that is already cancelled.
 */
export function createCancelledExecutionContext(
  options: Omit<ExecutionContextFactoryOptions, 'abortSignal'> = {}
): ExecutionContext {
  return createExecutionContext({
    ...options,
    abortSignal: AbortSignal.abort(),
  })
}

/**
 * Creates an execution context with a timeout.
 *
 * @example
 * ```ts
 * const ctx = createTimedExecutionContext(5000) // 5 second timeout
 * ```
 */
export function createTimedExecutionContext(
  timeoutMs: number,
  options: Omit<ExecutionContextFactoryOptions, 'abortSignal'> = {}
): ExecutionContext {
  return createExecutionContext({
    ...options,
    abortSignal: AbortSignal.timeout(timeoutMs),
  })
}
