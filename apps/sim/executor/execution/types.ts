import type { NormalizedBlockOutput } from '@/executor/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ContextExtensions {
  workspaceId?: string
  executionId?: string
  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>
  isDeployedContext?: boolean
  isChildExecution?: boolean
  resumeFromSnapshot?: boolean
  resumePendingQueue?: string[]
  onStream?: (streamingExecution: unknown) => Promise<void>
  onBlockStart?: (
    blockId: string,
    blockName: string,
    blockType: string,
    iterationContext?: {
      iterationCurrent: number
      iterationTotal: number
      iterationType: SubflowType
    }
  ) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: { input?: any; output: NormalizedBlockOutput; executionTime: number },
    iterationContext?: {
      iterationCurrent: number
      iterationTotal: number
      iterationType: SubflowType
    }
  ) => Promise<void>
}

export interface WorkflowInput {
  [key: string]: unknown
}
