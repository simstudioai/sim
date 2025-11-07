import type { TraceSpan } from '@/lib/logs/types'
import type { BlockOutput } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

export interface UserFile {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
  context?: string
}

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

export type ResumeStatus = 'paused' | 'resumed' | 'failed' | 'queued' | 'resuming'

export interface PausePoint {
  contextId: string
  blockId?: string
  response: any
  registeredAt: string
  resumeStatus: ResumeStatus
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
  files?: UserFile[]
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
  error?: string
  childTraceSpans?: TraceSpan[]
  childWorkflowName?: string
  _pauseMetadata?: PauseMetadata
}

export interface BlockLog {
  blockId: string
  blockName?: string
  blockType?: string
  startedAt: string
  endedAt: string
  durationMs: number
  success: boolean
  output?: any
  input?: any
  error?: string
  loopId?: string
  parallelId?: string
  iterationIndex?: number
}

export interface ExecutionMetadata {
  requestId?: string
  workflowId?: string
  workspaceId?: string
  startTime?: string
  endTime?: string
  duration: number
  pendingBlocks?: string[]
  isDebugSession?: boolean
  context?: ExecutionContext
  workflowConnections?: Array<{ source: string; target: string }>
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

export interface BlockState {
  output: NormalizedBlockOutput
  executed: boolean
  executionTime: number
}

export interface ExecutionContext {
  workflowId: string
  workspaceId?: string
  executionId?: string
  userId?: string
  isDeployedContext?: boolean

  blockStates: ReadonlyMap<string, BlockState>
  executedBlocks: ReadonlySet<string>

  blockLogs: BlockLog[]
  metadata: ExecutionMetadata
  environmentVariables: Record<string, string>
  workflowVariables?: Record<string, any>

  decisions: {
    router: Map<string, string>
    condition: Map<string, string>
  }

  completedLoops: Set<string>

  loopExecutions?: Map<
    string,
    {
      iteration: number
      currentIterationOutputs: Map<string, any>
      allIterationOutputs: any[][]
      maxIterations?: number
      item?: any
      items?: any[]
      condition?: string
      skipFirstConditionCheck?: boolean
      loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
    }
  >

  parallelExecutions?: Map<
    string,
    {
      parallelId: string
      totalBranches: number
      branchOutputs: Map<number, any[]>
      completedCount: number
      totalExpectedNodes: number
      parallelType?: 'count' | 'collection'
    }
  >

  parallelBlockMapping?: Map<
    string,
    {
      originalBlockId: string
      parallelId: string
      iterationIndex: number
    }
  >

  currentVirtualBlockId?: string

  activeExecutionPath: Set<string>

  workflow?: SerializedWorkflow

  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>

  onStream?: (streamingExecution: StreamingExecution) => Promise<void>
  onBlockStart?: (blockId: string, blockName: string, blockType: string) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: any
  ) => Promise<void>

  // Cancellation support
  isCancelled?: boolean
}

export interface ExecutionResult {
  success: boolean
  output: NormalizedBlockOutput
  error?: string
  logs?: BlockLog[]
  metadata?: ExecutionMetadata
  status?: 'completed' | 'paused'
  pausePoints?: PausePoint[]
  snapshotSeed?: SerializedSnapshot
  _streamingMetadata?: {
    loggingSession: any
    processedInput: any
  }
}

export interface StreamingExecution {
  stream: ReadableStream
  execution: ExecutionResult & { isStreaming?: boolean }
}

export interface BlockExecutor {
  canExecute(block: SerializedBlock): boolean

  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput>
}

export interface BlockHandler {
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
}

export interface ToolRegistry {
  [key: string]: Tool
}

export interface ResponseFormatStreamProcessor {
  processStream(
    originalStream: ReadableStream,
    blockId: string,
    selectedOutputs: string[],
    responseFormat?: any
  ): ReadableStream
}
