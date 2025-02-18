import { BlockOutput } from '@/blocks/types'

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
 * Describes the runtime context for executing a workflow,
 * including all block outputs (blockStates), metadata for timing, and block logs.
 */
export interface ExecutionMetadata {
  startTime?: string
  endTime?: string
}

export interface ExecutionContext {
  workflowId: string
  blockStates: Map<string, BlockOutput>
  blockLogs: BlockLog[]
  metadata: ExecutionMetadata
  environmentVariables?: Record<string, string>
}

/**
 * The complete result from executing the workflow. Includes success/fail,
 * the "last block" output, optional error, timing metadata, and logs of each block's run.
 */
export interface ExecutionResult {
  success: boolean
  output: BlockOutput
  error?: string
  logs?: BlockLog[]
  metadata?: {
    duration: number
    startTime: string
    endTime: string
  }
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
