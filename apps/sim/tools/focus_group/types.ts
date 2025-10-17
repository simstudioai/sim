import type { ToolResponse } from '@/tools/types'

export interface FocusGroupParams {
  objective: string
  region: string
  targetAudience: string
}

export interface FocusGroupResponse extends ToolResponse {
  output: {
    content: string
  }
}
