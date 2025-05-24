import { ToolResponse } from '../types'

export interface ThinkingToolParams {
  thought: string
}

export interface ThinkingToolResponse extends ToolResponse {
  output: {
    acknowledgedThought: string
  }
}
