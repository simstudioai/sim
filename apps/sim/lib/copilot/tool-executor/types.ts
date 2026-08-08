import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import type { SecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface ToolExecutionContext {
  userId: string
  workflowId: string
  workspaceId?: string
  chatId?: string
  messageId?: string
  executionId?: string
  runId?: string
  /** Stable identity of the individual tool call being executed. */
  toolCallId?: string
  billingAttribution?: BillingAttributionSnapshot
  copilotToolExecution?: boolean
  /** Server-owned base image selected from the fixed Go route for this turn. */
  sandboxProfile?: 'mothership'
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
  userTimezone?: string
  userPermission?: string
  secretMountPolicy?: SecretMountPolicy
  /** Undefined uses the execution actor; null explicitly disables raw secret mounting. */
  secretActorUserId?: string | null
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
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
