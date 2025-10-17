import type { ToolResponse } from '@/tools/types'

export interface PersuasionSupportEngineParams {
  objective: string
  supportingObjective?: string
  targetAudience: string
  region: string
  messages: string
}

export interface PersuasionSupportEngineResponse extends ToolResponse {
  output: {
    content: string
  }
}