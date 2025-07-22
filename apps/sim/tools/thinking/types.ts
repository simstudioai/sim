import type { ToolResponse } from '@/tools/types'

export interface ThinkingToolParams {
  thought: string
}

export interface ThinkingToolResponse extends ToolResponse {
  output: {
    acknowledgedThought: string
  }
}
