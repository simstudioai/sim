import type { BlockLog, BlockState, ExecutionMetadata as BaseExecutionMetadata } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import type { Edge } from 'reactflow'

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
  loopIterations: Record<string, number>
  loopItems: Record<string, any>
  completedLoops: string[]
  loopExecutions?: Record<string, any>
  parallelExecutions?: Record<string, any>
  parallelBlockMapping?: Record<string, any>
  activeExecutionPath: string[]
  pendingQueue?: string[]
  remainingEdges?: Edge[]
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

// TODO: Implement pause/resume functionality
// 
// Future implementation should include:
// 1. executor.pause() - Captures current state mid-execution
//    - Serialize ExecutionContext (blockStates, decisions, loops, etc) to state property
//    - Save snapshot.toJSON() to database
// 2. executor.resume(snapshot) - Reconstructs execution from saved state
//    - Load snapshot from database
//    - Restore ExecutionContext from state property
//    - Continue execution from pendingQueue
// 3. API endpoints:
//    - POST /api/executions/[id]/pause
//    - POST /api/executions/[id]/resume
// 4. Database schema:
//    - execution_snapshots table with snapshot JSON column

