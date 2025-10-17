import type { ToolResponse } from '@/tools/types'

export interface SymbolEvaluatorParams {
  objective: string
  supportingObjective?: string
  targetAudience: string
  region: string
  symbols: string
}

export interface SymbolEvaluatorResponse extends ToolResponse {
  output: {
    content: string
  }
}