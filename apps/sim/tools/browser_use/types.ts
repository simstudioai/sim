import type { ToolResponse } from '@/tools/types'

export interface BrowserUseRunTaskParams {
  task: string
  apiKey: string
  variables?: Record<string, string> | Array<Record<string, any>>
  model?: string
  startUrl?: string
  allowedDomains?: string | string[]
  maxSteps?: number
  flashMode?: boolean
  thinking?: boolean
  vision?: boolean | 'auto'
  systemPromptExtension?: string
  structuredOutput?: string
  highlightElements?: boolean
  metadata?: Record<string, string>
  profile_id?: string
}

interface BrowserUseTaskStep {
  number: number
  memory: string
  evaluationPreviousGoal: string
  nextGoal: string
  url: string
  screenshotUrl?: string | null
  actions: string[]
  duration?: number | null
}

interface BrowserUseTaskOutput {
  id: string
  success: boolean
  output: string | null
  steps: BrowserUseTaskStep[]
  liveUrl: string | null
  shareUrl: string | null
  sessionId: string | null
}

export interface BrowserUseRunTaskResponse extends ToolResponse {
  output: BrowserUseTaskOutput
}

export interface BrowserUseResponse extends ToolResponse {
  output: BrowserUseTaskOutput
}
