import type { ToolResponse } from '@/tools/types'

export interface TAFinderParams {
  objective: string
  region: string
  supportingObjective?: string
}

export interface TAFinderResponse extends ToolResponse {
  output: {
    content: string
  }
}