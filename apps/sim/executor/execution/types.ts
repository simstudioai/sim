import type { NormalizedBlockOutput } from '@/executor/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ContextExtensions {
  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>
  isDeployedContext?: boolean
  onStream?: (streamingExecution: unknown) => Promise<string>
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
    output: { output: NormalizedBlockOutput; executionTime: number },
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
