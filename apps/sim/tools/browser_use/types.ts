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

export interface BrowserUseRunV4Params {
  task: string
  apiKey: string
  model?: string
  sessionId?: string
  workspaceId?: string
  profileId?: string
  record?: boolean
  agentmail?: boolean
  maxCostUsd?: number
  secretBindings?: unknown
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

interface BrowserUseV4Output {
  id: string
  status: string
  result: string | null
  error: string | null
  model: string
  sessionId: string
  workspaceId: string | null
  totalCostUsd: string
  totalInputTokens: number
  totalOutputTokens: number
}

export interface BrowserUseRunTaskResponse extends ToolResponse {
  output: BrowserUseTaskOutput
}

export interface BrowserUseRunV4Response extends ToolResponse {
  output: BrowserUseV4Output
}

export interface BrowserUseResponse extends ToolResponse {
  output: BrowserUseTaskOutput | BrowserUseV4Output
}
