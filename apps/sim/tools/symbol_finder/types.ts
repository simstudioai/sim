import type { ToolResponse } from '@/tools/types'

export interface SymbolFinderParams {
  objective: string
  region: string
  targetAudience: string
}

export interface SymbolFinderResponse extends ToolResponse {
  output: {
    content: string
  }
}