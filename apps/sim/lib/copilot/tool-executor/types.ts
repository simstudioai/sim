import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { MothershipResource } from '@/lib/copilot/resources/types'

export interface ToolExecutionContext {
  userId: string
  workflowId: string
  workspaceId?: string
  chatId?: string
  messageId?: string
  executionId?: string
  runId?: string
  billingAttribution?: BillingAttributionSnapshot
  copilotToolExecution?: boolean
  requestMode?: string
  currentAgentId?: string
  /**
   * The invoking subagent's channel id (its outer tool_use id), threaded per
   * tool call so server tools can scope state to one subagent invocation. Two
   * concurrent file subagents share currentAgentId ("file") but have distinct
   * parentToolCallIds, so this — not currentAgentId — disambiguates them.
   */
  parentToolCallId?: string
  abortSignal?: AbortSignal
  /** Fires only when the user explicitly stops the Mothership run. */
  userStopSignal?: AbortSignal
  userTimezone?: string
  userPermission?: string
  decryptedEnvVars?: Record<string, string>
}

export interface ToolExecutionResult {
  success: boolean
  output?: unknown
  error?: string
  resources?: MothershipResource[]
}

export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>

export interface ToolCallDescriptor {
  toolCallId: string
  toolId: string
  params: Record<string, unknown>
}
