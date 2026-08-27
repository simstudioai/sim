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
  /**
   * Workflow execution id this tool call is already bound to, set only by the
   * copilot request handler when it wins the workflow-tool execution claim and
   * runs the tool server-side instead of waiting for a browser. Distinct from
   * `executionId`, which is the copilot run's own identity and is re-emitted
   * into the principal by `requireTrustedCopilotExecutionContext`.
   */
  boundWorkflowExecutionId?: string
  billingAttribution?: BillingAttributionSnapshot
  copilotToolExecution?: boolean
  /** Trusted lifecycle classification stamped by the server, never from model parameters. */
  copilotInteractionMode?: 'interactive' | 'headless'
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
