/** Runtime-neutral contract between the Codex block handler and cloud backends. */

import type { CodexEvent, CodexRunTotals } from '@/executor/handlers/codex/core/events'
import type { CodexAgentSession } from '@/executor/handlers/codex/core/session'
import type { CodexModel, CodexReasoningEffort } from '@/providers/codex'

interface CodexRunBaseParams {
  agentId: string
  model: CodexModel
  apiKey: string
  task: string
  reasoningEffort: CodexReasoningEffort
  networkAccess: boolean
}

interface CodexGitHubParams {
  owner: string
  repo: string
  githubToken: string
  baseBranch?: string
}

/** Parameters for a disposable repository exploration run. */
export interface CodexCloudPlanRunParams extends CodexRunBaseParams, CodexGitHubParams {
  mode: 'cloud_plan'
}

/** Parameters for a run that creates a new branch and pull request. */
export interface CodexCloudRunParams extends CodexRunBaseParams, CodexGitHubParams {
  mode: 'cloud'
  branchName?: string
  draft: boolean
  prTitle?: string
  prBody?: string
}

export type CodexRunParams = CodexCloudPlanRunParams | CodexCloudRunParams

/** Progress callbacks and cancellation passed into a backend. */
export interface CodexRunContext {
  onEvent: (event: CodexEvent) => void
  signal?: AbortSignal
  session: CodexAgentSession
}

/** Final output returned to the block handler. */
export interface CodexBackendResult {
  totals: CodexRunTotals
  status: 'completed'
  changedFiles?: string[]
  diff?: string
  prUrl?: string
  branch?: string
}

export interface CodexRunResult extends CodexBackendResult {
  agentId: string
  sessionReused: boolean
  turnNumber: number
}

export type CodexBackendRun<P extends CodexRunParams = CodexRunParams> = (
  params: P,
  context: CodexRunContext
) => Promise<CodexBackendResult>
