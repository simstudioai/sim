import type { TraceSpan } from '@/lib/logs/types'
import type { BlockOutput } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * User-facing file object with simplified interface
 */
export interface UserFile {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
  uploadedAt: string
  expiresAt: string
  context?: string
}

/**
 * Standardized block output format that ensures compatibility with the execution engine.
 */
export interface ParallelPauseScope {
  parallelId: string
  branchIndex: number
  branchTotal?: number
}

export interface LoopPauseScope {
  loopId: string
  iteration: number
}

export interface PauseMetadata {
  contextId: string
  blockId: string
  response: any
  timestamp: string
  parallelScope?: ParallelPauseScope
  loopScope?: LoopPauseScope
  resumeLinks?: {
    apiUrl: string
    uiUrl: string
    contextId: string
    executionId: string
    workflowId: string
  }
}

export interface PausePoint {
  contextId: string
  blockId?: string
  response: any
  registeredAt: string
  resumeStatus: 'paused' | 'resumed' | 'failed' | 'queued' | 'resuming'
  snapshotReady: boolean
  parallelScope?: ParallelPauseScope
  loopScope?: LoopPauseScope
  resumeLinks?: {
    apiUrl: string
    uiUrl: string
    contextId: string
    executionId: string
    workflowId: string
  }
}

export interface SerializedSnapshot {
  snapshot: string
  triggerIds: string[]
}

export interface NormalizedBlockOutput {
  [key: string]: any
  // Content fields
  content?: string // Text content from LLM responses
  model?: string // Model identifier used for generation
  tokens?: {
    prompt?: number
    completion?: number
    total?: number
  }
  toolCalls?: {
    list: any[]
    count: number
  }
  // File fields
  files?: UserFile[] // Binary files/attachments from this block
  // Path selection fields
  selectedPath?: {
    blockId: string
    blockType?: string
    blockTitle?: string
  }
  selectedConditionId?: string // ID of selected condition
  conditionResult?: boolean // Whether condition evaluated to true
  // Generic result fields
  result?: any // Generic result value
  stdout?: string // Standard output from function execution
  executionTime?: number // Time taken to execute
  // API response fields
  data?: any // Response data from API calls
  status?: number // HTTP status code
  headers?: Record<string, string> // HTTP headers
  // Error handling
  error?: string // Error message if block execution failed
  // Child workflow introspection (for workflow blocks)
  childTraceSpans?: TraceSpan[]
  childWorkflowName?: string
  // Pause metadata
  _pauseMetadata?: PauseMetadata
}

/**
 * Execution log entry for a single block.
 */
export interface BlockLog {
  blockId: string // Unique identifier of the executed block
  blockName?: string // Display name of the block
  blockType?: string // Type of the block (agent, router, etc.)
  startedAt: string // ISO timestamp when execution started
  endedAt: string // ISO timestamp when execution completed
  durationMs: number // Duration of execution in milliseconds
  success: boolean // Whether execution completed successfully
  output?: any // Output data from successful execution
  input?: any // Input data for the block execution
  error?: string // Error message if execution failed
  loopId?: string // Loop ID if this block is part of a loop
  parallelId?: string // Parallel ID if this block is part of a parallel
  iterationIndex?: number // Iteration number for loop/parallel blocks
}

/**
 * Timing metadata for workflow execution.
 */
export interface ExecutionMetadata {
  requestId?: string
  workflowId?: string
  workspaceId?: string
  startTime?: string // ISO timestamp when workflow execution started
  endTime?: string // ISO timestamp when workflow execution completed
  duration: number // Duration of workflow execution in milliseconds
  pendingBlocks?: string[] // List of block IDs that are pending execution
  isDebugSession?: boolean // Whether the workflow is running in debug mode
  context?: ExecutionContext // Runtime context for the workflow
  workflowConnections?: Array<{ source: string; target: string }> // Connections between workflow blocks
  status?: 'running' | 'paused' | 'completed'
  pausePoints?: string[]
  resumeChain?: {
    parentExecutionId?: string
    depth: number
  }
  userId?: string
  executionId?: string
  triggerType?: string
  triggerBlockId?: string
  useDraftState?: boolean
  resumeFromSnapshot?: boolean
}

/**
 * Current state of a block during workflow execution.
 */
export interface BlockState {
  output: NormalizedBlockOutput // Current output data from the block
  executed: boolean // Whether the block has been executed
  executionTime: number // Time taken to execute in milliseconds
}

/**
 * Runtime context for workflow execution.
 */
export interface ExecutionContext {
  workflowId: string // Unique identifier for this workflow execution
  workspaceId?: string // Workspace ID for file storage scoping
  executionId?: string // Unique execution ID for file storage scoping
  // Whether this execution is running against deployed state (API/webhook/schedule/chat)
  // Manual executions in the builder should leave this undefined/false
  isDeployedContext?: boolean

  // CONSOLIDATED STATE - Single source of truth for execution state
  // Uses shared references with ExecutionState class
  blockStates: ReadonlyMap<string, BlockState>
  executedBlocks: ReadonlySet<string> // Set of block IDs that have been executed

  blockLogs: BlockLog[] // Chronological log of block executions
  metadata: ExecutionMetadata // Timing metadata for the execution
  environmentVariables: Record<string, string> // Environment variables available during execution
  workflowVariables?: Record<string, any> // Workflow variables available during execution

  // Routing decisions for path determination
  decisions: {
    router: Map<string, string> // Router block ID -> Target block ID
    condition: Map<string, string> // Condition block ID -> Selected condition ID
  }

  completedLoops: Set<string> // Tracks which loops have completed all iterations

  // Loop execution tracking - single source of truth for loop state
  loopExecutions?: Map<
    string,
    {
      iteration: number // Current iteration
      currentIterationOutputs: Map<string, any> // Outputs from blocks in current iteration
      allIterationOutputs: any[][] // Outputs from all completed iterations
      maxIterations?: number
      item?: any // Current item (for forEach loops)
      items?: any[] // All items (for forEach loops)
      condition?: string // Loop condition expression
      skipFirstConditionCheck?: boolean // For do-while loops
      loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
    }
  >

  // Parallel execution tracking - single source of truth for parallel state
  parallelExecutions?: Map<
    string,
    {
      parallelId: string
      totalBranches: number
      branchOutputs: Map<number, any[]> // Outputs from each branch
      completedCount: number
      totalExpectedNodes: number
      parallelType?: 'count' | 'collection'
    }
  >

  // Mapping for virtual parallel block IDs to their original blocks
  parallelBlockMapping?: Map<
    string,
    {
      originalBlockId: string
      parallelId: string
      iterationIndex: number
    }
  >

  // Current virtual block being executed (for parallel iterations)
  currentVirtualBlockId?: string

  activeExecutionPath: Set<string> // Set of block IDs in the current execution path

  workflow?: SerializedWorkflow // Reference to the workflow being executed

  // Streaming support and output selection
  stream?: boolean // Whether to use streaming responses when available
  selectedOutputs?: string[] // IDs of blocks selected for streaming output
  edges?: Array<{ source: string; target: string }> // Workflow edge connections

  // New context extensions
  onStream?: (streamingExecution: StreamingExecution) => Promise<void>
  onBlockStart?: (blockId: string, blockName: string, blockType: string) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: any
  ) => Promise<void>
}

/**
 * Complete result from executing a workflow.
 */
export interface ExecutionResult {
  success: boolean // Whether the workflow executed successfully
  output: NormalizedBlockOutput // Final output data from the workflow
  error?: string // Error message if execution failed
  logs?: BlockLog[] // Execution logs for all blocks
  metadata?: ExecutionMetadata
  status?: 'completed' | 'paused'
  pausePoints?: PausePoint[]
  snapshotSeed?: SerializedSnapshot
  _streamingMetadata?: {
    // Internal metadata for streaming execution
    loggingSession: any
    processedInput: any
  }
}

/**
 * Streaming execution result combining a readable stream with execution metadata.
 * This allows us to stream content to the UI while still capturing all execution logs.
 */
export interface StreamingExecution {
  stream: ReadableStream // The streaming response for the UI to consume
  execution: ExecutionResult & { isStreaming?: boolean } // The complete execution data for logging purposes
}

/**
 * Interface for a block executor component.
 */
export interface BlockExecutor {
  /**
   * Determines if this executor can process the given block.
   */
  canExecute(block: SerializedBlock): boolean

  /**
   * Executes the block with the given inputs and context.
   */
  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput>
}

/**
 * Interface for block handlers that execute specific block types.
 * Each handler is responsible for executing a particular type of block.
 */
export interface BlockHandler {
  /**
   * Determines if this handler can process the given block.
   *
   * @param block - Block to check
   * @returns True if this handler can process the block
   */
  canHandle(block: SerializedBlock): boolean

  execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution>

  executeWithNode?: (
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: {
      nodeId: string
      loopId?: string
      parallelId?: string
      branchIndex?: number
      branchTotal?: number
    }
  ) => Promise<BlockOutput | StreamingExecution>
}

/**
 * Definition of a tool that can be invoked by blocks.
 *
 * @template P - Parameter type for the tool
 * @template O - Output type from the tool
 */
export interface Tool<P = any, O = Record<string, any>> {
  id: string // Unique identifier for the tool
  name: string // Display name of the tool
  description: string // Description of what the tool does
  version: string // Version string for the tool

  // Parameter definitions for the tool
  params: {
    [key: string]: {
      type: string // Data type of the parameter
      required?: boolean // Whether the parameter is required
      description?: string // Description of the parameter
      default?: any // Default value if not provided
    }
  }

  // HTTP request configuration for API tools
  request?: {
    url?: string | ((params: P) => string) // URL or function to generate URL
    method?: string // HTTP method to use
    headers?: (params: P) => Record<string, string> // Function to generate request headers
    body?: (params: P) => Record<string, any> // Function to generate request body
  }

  // Function to transform API response to tool output
  transformResponse?: (response: any) => Promise<{
    success: boolean
    output: O
    error?: string
  }>
}

/**
 * Registry of available tools indexed by ID.
 */
export interface ToolRegistry {
  [key: string]: Tool
}

/**
 * Interface for a stream processor that can process a stream based on a response format.
 */
export interface ResponseFormatStreamProcessor {
  processStream(
    originalStream: ReadableStream,
    blockId: string,
    selectedOutputs: string[],
    responseFormat?: any
  ): ReadableStream
}
