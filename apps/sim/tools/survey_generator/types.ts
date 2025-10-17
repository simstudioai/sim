import type { ToolResponse } from '@/tools/types'

export interface SurveyGeneratorParams {
  objective: string
  region: string
  targetAudience: string
  numQuestions: number
}

export interface SurveyGeneratorResponse extends ToolResponse {
  output: {
    content: string
  }
}