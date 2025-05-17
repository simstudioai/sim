import { ToolResponse } from '../types'

export interface BrowserUseRunTaskParams {
  task: string
  apiKey: string
  outputSchema?: Record<string, any>
  variables?: Record<string, string>
  llmModel?: string
}

export interface BrowserUseTaskStep {
  id: string
  step: number
  evaluation_previous_goal: string
  next_goal: string
}

export interface BrowserUseTaskOutput {
  id: string
  task: string
  output: any
  status: 'created' | 'running' | 'finished' | 'stopped' | 'paused' | 'failed'
  steps: BrowserUseTaskStep[]
  live_url: string | null
  structuredOutput?: Record<string, any>
  agentResult?: {
    success: boolean
    completed: boolean
    message: string
    actions: Array<any>
  }
}

export interface BrowserUseRunTaskResponse extends ToolResponse {
  output: BrowserUseTaskOutput
}
