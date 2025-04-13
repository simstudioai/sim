import { ToolResponse } from '../types'

export interface BrowserUseRunTaskParams {
  task: string
  apiKey: string
  pollInterval?: number
  maxPollTime?: number
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
  output: string | null
  status: 'created' | 'running' | 'finished' | 'stopped' | 'paused' | 'failed'
  steps: BrowserUseTaskStep[]
  live_url: string | null
}

export interface BrowserUseRunTaskResponse extends ToolResponse {
  output: BrowserUseTaskOutput
}
