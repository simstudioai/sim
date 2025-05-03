import { BlockOutput } from '@/blocks/types'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * Standardized block output format that ensures compatibility with the execution engine.
 */
export interface NormalizedBlockOutput {
  /** Primary response data from the block execution */
  response: {
    [key: string]: any
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
    selectedPath?: {
      blockId: string
      blockType?: string
      blockTitle?: string
    }
    selectedConditionId?: string // ID of selected condition
    conditionResult?: boolean // Whether condition evaluated to true
    result?: any // Generic result value
    stdout?: string // Standard output from function execution
    executionTime?: number // Time taken to execute
    data?: any // Response data from API calls
    status?: number // HTTP status code
    headers?: Record<string, string> // HTTP headers
    error?: string // Error message if block execution failed
  }
  error?: string // Top-level error field for easy error checking
  [key: string]: any // Additional properties
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
  error?: string // Error message if execution failed
}

/**
 * Timing metadata for workflow execution.
 */
export interface ExecutionMetadata {
  startTime?: string // ISO timestamp when workflow execution started
  endTime?: string // ISO timestamp when workflow execution completed
  duration: number // Duration of workflow execution in milliseconds
  pendingBlocks?: string[] // List of block IDs that are pending execution
  isDebugSession?: boolean // Whether the workflow is running in debug mode
  context?: ExecutionContext // Runtime context for the workflow
  workflowConnections?: Array<{ source: string; target: string }> // Connections between workflow blocks
}

/**
 * Current state of a block during workflow execution.
 */
export interface BlockState {
  output: NormalizedBlockOutput // Current output data from the block
  executed: boolean // Whether the block has been executed
  executionTime?: number // Time taken to execute in milliseconds
}

/**
 * Runtime context for workflow execution.
 */
export interface ExecutionContext {
  workflowId: string // Unique identifier for this workflow execution
  blockStates: Map<string, BlockState> // Map of block states indexed by block ID
  blockLogs: BlockLog[] // Chronological log of block executions
  metadata: ExecutionMetadata // Timing metadata for the execution
  environmentVariables: Record<string, string> // Environment variables available during execution

  // Routing decisions for path determination
  decisions: {
    router: Map<string, string> // Router block ID -> Target block ID
    condition: Map<string, string> // Condition block ID -> Selected condition ID
  }

  loopIterations: Map<string, number> // Tracks current iteration count for each loop
  loopItems: Map<string, any> // Tracks current item for forEach loops
  completedLoops: Set<string> // Tracks which loops have completed all iterations

  // Execution tracking
  executedBlocks: Set<string> // Set of block IDs that have been executed
  activeExecutionPath: Set<string> // Set of block IDs in the current execution path

  workflow?: SerializedWorkflow // Reference to the workflow being executed
  
  // Streaming support and output selection
  stream?: boolean // Whether to use streaming responses when available
  selectedOutputIds?: string[] // IDs of blocks selected for streaming output
  edges?: Array<{source: string, target: string}> // Workflow edge connections
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

  /**
   * Executes the block with the given inputs and context.
   *
   * @param block - Block to execute
   * @param inputs - Resolved input parameters
   * @param context - Current execution context
   * @returns Block execution output or StreamingExecution for streaming
   */
  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution>
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

  transformError?: (error: any) =>
    | string
    | Promise<{
        success: boolean
        output: O
        error?: string
      }> // Function to format error messages
}

/**
 * Registry of available tools indexed by ID.
 */
export interface ToolRegistry {
  [key: string]: Tool
}
