import type { ToolResponse } from '@/tools/types'

export interface BarrierExtractorParams {
  objective: string
  region: string
  targetAudience: string
}

export interface BarrierExtractorResponse extends ToolResponse {
  output: {
    content: string
  }
}