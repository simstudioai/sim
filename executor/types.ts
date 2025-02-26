import { BlockOutput } from '@/blocks/types'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * We require a specific shape for our block outputs that always includes a response property.
 * This type ensures compatibility with the engine's expectations.
 */
export interface NormalizedBlockOutput {
  response: {
    [key: string]: any
    // Properties we expect from various block types
    content?: string
    model?: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    toolCalls?: {
      list: any[]
      count: number
    }
    selectedPath?: {
      blockId: string
      blockType?: string
      blockTitle?: string
    }
    selectedConditionId?: string
    conditionResult?: boolean
    result?: any
    stdout?: string
    executionTime?: number
    data?: any
    status?: number
    headers?: Record<string, string>
  }
  [key: string]: any // Allow additional properties
}

/**
 * Describes a single block's logs, including timing and success/failure state.
 */
export interface BlockLog {
  blockId: string
  blockName?: string
  blockType?: string
  startedAt: string
  endedAt: string
  durationMs: number
  success: boolean
  output?: any
  error?: string
}

/**
 * Describes the runtime metadata for a workflow execution
 */
export interface ExecutionMetadata {
  startTime?: string
  endTime?: string
}

/**
 * Represents the state of a block during execution
 */
export interface BlockState {
  output: NormalizedBlockOutput // Current output data
  executed: boolean // Whether the block has been executed
  executionTime?: number // Time taken to execute (ms)
}

/**
 * Describes the runtime context for executing a workflow,
 * including all block outputs (blockStates), metadata for timing, and block logs.
 */
export interface ExecutionContext {
  workflowId: string
  blockStates: Map<string, BlockState>
  blockLogs: BlockLog[]
  metadata: ExecutionMetadata
  environmentVariables: Record<string, string>

  // Routing decisions for easier path determination
  decisions: {
    router: Map<string, string> // Router block ID -> Target block ID
    condition: Map<string, string> // Condition block ID -> Selected condition ID
  }

  // Loop state tracking
  loopIterations: Map<string, number>

  // Execution tracking
  executedBlocks: Set<string> // Set of block IDs that have been executed
  activeExecutionPath: Set<string> // Set of block IDs in the current execution path

  // Reference to the workflow (added in handlers.ts)
  workflow?: SerializedWorkflow
}

/**
 * The complete result from executing the workflow. Includes success/fail,
 * the "last block" output, optional error, timing metadata, and logs of each block's run.
 */
export interface ExecutionResult {
  success: boolean
  output: NormalizedBlockOutput
  error?: string
  logs?: BlockLog[]
  metadata?: {
    duration: number
    startTime: string
    endTime: string
  }
}

/**
 * Options for configuring an executor
 */
export interface ExecutionOptions {
  maxLoopIterations?: number // Maximum iterations for any loop
  continueOnError?: boolean // Whether to continue execution after errors
  timeoutMs?: number // Maximum execution time
}

/**
 * Interface for a block executor
 */
export interface BlockExecutor {
  canExecute(block: SerializedBlock): boolean
  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput>
}

/**
 * Defines how a particular tool is invoked (URLs, headers, etc.), how it transforms responses
 * and handles errors. Used by blocks that reference a particular tool ID.
 */
export interface Tool<P = any, O = Record<string, any>> {
  id: string
  name: string
  description: string
  version: string
  params: {
    [key: string]: {
      type: string
      required?: boolean
      description?: string
      default?: any
    }
  }
  request?: {
    url?: string | ((params: P) => string)
    method?: string
    headers?: (params: P) => Record<string, string>
    body?: (params: P) => Record<string, any>
  }
  transformResponse?: (response: any) => Promise<{
    success: boolean
    output: O
    error?: string
  }>
  transformError?: (error: any) => string
}

/**
 * A registry of Tools, keyed by their IDs or names.
 */
export interface ToolRegistry {
  [key: string]: Tool
}
