/**
 * Factory functions for creating ExecutionContext test fixtures for executor tests.
 * This is the executor-specific context, different from the generic testing context.
 */

import type {
  SerializedBlock,
  SerializedConnection,
  SerializedWorkflow,
} from './serialized-block.factory'

/**
 * Block state in execution context.
 */
export interface ExecutorBlockState {
  output: Record<string, any>
  executed: boolean
  executionTime: number
}

/**
 * Execution context for executor tests.
 */
export interface ExecutorContext {
  workflowId: string
  workspaceId?: string
  executionId?: string
  userId?: string
  blockStates: Map<string, ExecutorBlockState>
  executedBlocks: Set<string>
  blockLogs: any[]
  metadata: {
    duration: number
    startTime?: string
    endTime?: string
  }
  environmentVariables: Record<string, string>
  workflowVariables?: Record<string, any>
  decisions: {
    router: Map<string, string>
    condition: Map<string, string>
  }
  loopExecutions: Map<string, any>
  completedLoops: Set<string>
  activeExecutionPath: Set<string>
  workflow?: SerializedWorkflow
  currentVirtualBlockId?: string
  abortSignal?: AbortSignal
}

/**
 * Options for creating an executor context.
 */
export interface ExecutorContextFactoryOptions {
  workflowId?: string
  workspaceId?: string
  executionId?: string
  userId?: string
  blockStates?: Map<string, ExecutorBlockState> | Record<string, ExecutorBlockState>
  executedBlocks?: Set<string> | string[]
  blockLogs?: any[]
  metadata?: {
    duration?: number
    startTime?: string
    endTime?: string
  }
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  workflow?: SerializedWorkflow
  currentVirtualBlockId?: string
  abortSignal?: AbortSignal
}

/**
 * Creates an executor context with sensible defaults.
 *
 * @example
 * ```ts
 * const ctx = createExecutorContext({ workflowId: 'test-wf' })
 *
 * // With pre-populated block states
 * const ctx = createExecutorContext({
 *   blockStates: {
 *     'block-1': { output: { value: 10 }, executed: true, executionTime: 100 }
 *   }
 * })
 * ```
 */
export function createExecutorContext(
  options: ExecutorContextFactoryOptions = {}
): ExecutorContext {
  let blockStates: Map<string, ExecutorBlockState>
  if (options.blockStates instanceof Map) {
    blockStates = options.blockStates
  } else if (options.blockStates) {
    blockStates = new Map(Object.entries(options.blockStates))
  } else {
    blockStates = new Map()
  }

  let executedBlocks: Set<string>
  if (options.executedBlocks instanceof Set) {
    executedBlocks = options.executedBlocks
  } else if (Array.isArray(options.executedBlocks)) {
    executedBlocks = new Set(options.executedBlocks)
  } else {
    executedBlocks = new Set()
  }

  return {
    workflowId: options.workflowId ?? 'test-workflow-id',
    workspaceId: options.workspaceId ?? 'test-workspace-id',
    executionId: options.executionId,
    userId: options.userId,
    blockStates,
    executedBlocks,
    blockLogs: options.blockLogs ?? [],
    metadata: {
      duration: options.metadata?.duration ?? 0,
      startTime: options.metadata?.startTime,
      endTime: options.metadata?.endTime,
    },
    environmentVariables: options.environmentVariables ?? {},
    workflowVariables: options.workflowVariables,
    decisions: {
      router: new Map(),
      condition: new Map(),
    },
    loopExecutions: new Map(),
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    workflow: options.workflow,
    currentVirtualBlockId: options.currentVirtualBlockId,
    abortSignal: options.abortSignal,
  }
}

/**
 * Creates an executor context with pre-executed blocks.
 *
 * @example
 * ```ts
 * const ctx = createExecutorContextWithBlocks({
 *   'source-block': { value: 10, text: 'hello' },
 *   'other-block': { result: true }
 * })
 * ```
 */
export function createExecutorContextWithBlocks(
  blockOutputs: Record<string, Record<string, any>>,
  options: Omit<ExecutorContextFactoryOptions, 'blockStates' | 'executedBlocks'> = {}
): ExecutorContext {
  const blockStates = new Map<string, ExecutorBlockState>()
  const executedBlocks = new Set<string>()

  for (const [blockId, output] of Object.entries(blockOutputs)) {
    blockStates.set(blockId, {
      output,
      executed: true,
      executionTime: 100,
    })
    executedBlocks.add(blockId)
  }

  return createExecutorContext({
    ...options,
    blockStates,
    executedBlocks,
  })
}

/**
 * Adds a block state to an existing context.
 * Returns the context for chaining.
 */
export function addBlockState(
  ctx: ExecutorContext,
  blockId: string,
  output: Record<string, any>,
  executionTime = 100
): ExecutorContext {
  ;(ctx.blockStates as Map<string, ExecutorBlockState>).set(blockId, {
    output,
    executed: true,
    executionTime,
  })
  ;(ctx.executedBlocks as Set<string>).add(blockId)
  return ctx
}

/**
 * Creates a minimal workflow for context.
 */
export function createMinimalWorkflow(
  blocks: SerializedBlock[],
  connections: SerializedConnection[] = []
): SerializedWorkflow {
  return {
    version: '1.0',
    blocks,
    connections,
    loops: {},
    parallels: {},
  }
}
