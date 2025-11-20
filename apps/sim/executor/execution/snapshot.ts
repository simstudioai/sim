import type { Edge } from 'reactflow'
import type { BlockLog, BlockState } from '@/executor/types'

export interface ExecutionMetadata {
  requestId: string
  executionId: string
  workflowId: string
  workspaceId?: string
  userId: string
  triggerType: string
  triggerBlockId?: string
  useDraftState: boolean
  startTime: string
  pendingBlocks?: string[]
  resumeFromSnapshot?: boolean
  workflowStateOverride?: {
    blocks: Record<string, any>
    edges: Edge[]
    loops?: Record<string, any>
    parallels?: Record<string, any>
  }
}

export interface ExecutionCallbacks {
  onStream?: (streamingExec: any) => Promise<void>
  onBlockStart?: (blockId: string, blockName: string, blockType: string) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: any
  ) => Promise<void>
  onExecutorCreated?: (executor: any) => void
}

export interface SerializableExecutionState {
  blockStates: Record<string, BlockState>
  executedBlocks: string[]
  blockLogs: BlockLog[]
  decisions: {
    router: Record<string, string>
    condition: Record<string, string>
  }
  completedLoops: string[]
  loopExecutions?: Record<string, any>
  parallelExecutions?: Record<string, any>
  parallelBlockMapping?: Record<string, any>
  activeExecutionPath: string[]
  pendingQueue?: string[]
  remainingEdges?: Edge[]
  dagIncomingEdges?: Record<string, string[]>
  completedPauseContexts?: string[]
}

export class ExecutionSnapshot {
  constructor(
    public readonly metadata: ExecutionMetadata,
    public readonly workflow: any,
    public readonly input: any,
    public readonly environmentVariables: Record<string, string>,
    public readonly workflowVariables: Record<string, any>,
    public readonly selectedOutputs: string[] = [],
    public readonly state?: SerializableExecutionState
  ) {}

  toJSON(): string {
    return JSON.stringify({
      metadata: this.metadata,
      workflow: this.workflow,
      input: this.input,
      environmentVariables: this.environmentVariables,
      workflowVariables: this.workflowVariables,
      selectedOutputs: this.selectedOutputs,
      state: this.state,
    })
  }

  static fromJSON(json: string): ExecutionSnapshot {
    const data = JSON.parse(json)
    return new ExecutionSnapshot(
      data.metadata,
      data.workflow,
      data.input,
      data.environmentVariables,
      data.workflowVariables,
      data.selectedOutputs,
      data.state
    )
  }
}
