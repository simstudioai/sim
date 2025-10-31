import type { NormalizedBlockOutput } from '@/executor/types'
export interface ContextExtensions {
  stream?: boolean
  selectedOutputs?: string[]
  edges?: Array<{ source: string; target: string }>
  isDeployedContext?: boolean
  onStream?: (streamingExecution: unknown) => Promise<string>
  onBlockStart?: (blockId: string, blockName: string, blockType: string) => Promise<void>
  onBlockComplete?: (
    blockId: string,
    blockName: string,
    blockType: string,
    output: { output: NormalizedBlockOutput; executionTime: number }
  ) => Promise<void>
}

export interface WorkflowInput {
  [key: string]: unknown
}
