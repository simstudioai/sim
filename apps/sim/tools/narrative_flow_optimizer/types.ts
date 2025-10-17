import type { ToolResponse } from '@/tools/types'

export interface NarrativeFlowOptimizerParams {
  objective: string
  supportingObjective?: string
  targetAudience: string
  region: string
  narrative: string
}

export interface NarrativeFlowOptimizerResponse extends ToolResponse {
  output: {
    content: string
  }
}