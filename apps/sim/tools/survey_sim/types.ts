import type { ToolResponse } from '@/tools/types'

export interface SurveySimParams {
  objective: string
  region: string
  targetAudience: string
  surveyQuestions: string
}

export interface SurveySimResponse extends ToolResponse {
  output: {
    content: string
  }
}