import type { ToolResponse } from '@/tools/types'

export interface BrowserUseRunTaskParams {
  task: string
  apiKey: string
  variables?: Record<string, string>
  model?: string
  save_browser_data?: boolean
}

export interface BrowserUseTaskStep {
  id: string
  step: number
  evaluation_previous_goal: string
  next_goal: string
  url?: string
  extracted_data?: Record<string, any>
}

export interface BrowserUseTaskOutput {
  id: string
  success: boolean
  output: any
  steps: BrowserUseTaskStep[]
}

export interface BrowserUseRunTaskResponse extends ToolResponse {
  output: BrowserUseTaskOutput
}

export interface BrowserUseResponse extends ToolResponse {
  output: {
    id: string
    success: boolean
    output: any
    steps: BrowserUseTaskStep[]
  }
}
