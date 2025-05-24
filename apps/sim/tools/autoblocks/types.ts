import type { ToolResponse } from '../types'

export interface PromptManagerParams {
  promptId: string
  version: string
  specificVersion?: string
  templateParams?: Record<string, any>
  apiKey: string
  enableABTesting?: boolean
  abTestConfig?: {
    versions: Array<{
      version: string
      weight: number
    }>
  }
  environment: string
}

export interface PromptManagerResponse extends ToolResponse {
  output: {
    promptId: string
    version: string
    renderedPrompt: string
    templates: Record<string, string>
  }
}
