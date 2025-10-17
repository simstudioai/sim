import type { ToolResponse } from '@/tools/types'

export interface AudiencePersonaGeneratorRequest {
  objective: string
  targetAudience: string
  region: string
  numPersonas: number
}

export interface AudiencePersonaGeneratorResponse extends ToolResponse {
  output: {
    content: string
  }
}