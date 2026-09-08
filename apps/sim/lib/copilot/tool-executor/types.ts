import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { MothershipResourceUpdate } from '@/lib/copilot/resources/types'
import type { SecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface ToolExecutionContext {
  userId: string
  workflowId: string
  workspaceId?: string
  organizationId?: string
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
  assistantSearch?: WorkspaceSearchFilters
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

/**
 * How far a tool call got in performing its side effect.
 *
 * This is a property of the call, not of the content it produced, which is why it
 * can still be reported when the content itself cannot cross the model boundary.
 * It is the only thing that lets a caller decide about retry: a rejected call and a
 * completed mutation are otherwise indistinguishable once their payloads are withheld.
 */
export const TOOL_EFFECT_PHASE = {
  /** Rejected before anything could happen. Correcting the call and retrying is safe. */
  notAttempted: 'not_attempted',
  /**
   * Dispatched; zero or one effects may exist. Resolve by id before retrying.
   *
   * Zero is a legitimate outcome here, not a defect: the id is a correlation key, not a
   * promise that a row exists. Narrowing this to "a run definitely exists" would take
   * per-block instrumentation across every execution in the product to spare one caller a
   * lookup that answers the question definitively either way.
   */
  attempted: 'attempted',
  /** The effect ran to completion, whatever its outcome. Never retry blind. */
  performed: 'performed',
} as const
export type ToolEffectPhase = (typeof TOOL_EFFECT_PHASE)[keyof typeof TOOL_EFFECT_PHASE]

export interface ToolCallEffect {
  phase: ToolEffectPhase
  /**
   * Server-minted identifiers naming the effect, so an unreadable result stays
   * resolvable. Values must be identifiers this system issues; the egress
   * projection rejects the whole disclosure otherwise.
   */
  ids?: Readonly<Record<string, string>>
}

export interface ToolExecutionResult {
  success: boolean
  output?: unknown
  error?: string
  resources?: MothershipResourceUpdate[]
  /**
   * Declared by tools whose failure a caller cannot otherwise act on. Consumed by
   * the egress projection and never returned to the model as-is — on a withheld
   * result it becomes the disclosure record that replaces the dropped content.
   */
  effect?: ToolCallEffect
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
