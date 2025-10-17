import type { ToolResponse } from '@/tools/types'

export interface MessageTesterParams {
  objective: string
  region: string
  targetAudience: string
  message: string
}

export interface MessageTesterResponse extends ToolResponse {
  output: {
    content: string
  }
}