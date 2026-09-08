import type { z } from 'zod'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface ServerToolContext {
  requestMode?: string
  assistantSearch?: WorkspaceSearchFilters
  userId: string
  workspaceId?: string
  organizationId?: string
  executionId?: string
  /** Stable, server-issued identity of the tool call currently executing. */
  toolCallId?: string
  /** True only for contexts built by the authenticated Copilot execution pipeline. */
  copilotToolExecution?: boolean
  billingAttribution?: BillingAttributionSnapshot
  userPermission?: string
  chatId?: string
  messageId?: string
  /**
   * The invoking subagent's channel id (its outer tool_use id). Used to scope
   * the prepare_file_edit -> apply_file_edit intent handoff to a single file subagent
   * so two file agents writing concurrently never consume each other's pending
   * intent. Undefined for main-agent tool calls (which never overlap).
   */
  parentToolCallId?: string
  abortSignal?: AbortSignal
  /** Fires only on explicit user stop, never on passive transport disconnect. */
  userStopSignal?: AbortSignal
  /** Private in-process provenance channel; never copied into tool arguments or results. */
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
}

export function assertServerToolNotAborted(
  context?: ServerToolContext,
  message = 'Request aborted before tool mutation could be applied.'
): void {
  if (context?.userStopSignal?.aborted) {
    const reason = context.userStopSignal.reason
      ? ` (reason: ${String(context.userStopSignal.reason)})`
      : ''
    throw new Error(`${message}${reason}`)
  }
}

/**
 * Base interface for server-side copilot tools.
 *
 * Tools can optionally declare Zod schemas for input/output validation.
 * If provided, the router validates automatically.
 */
export interface BaseServerTool<TArgs = unknown, TResult = unknown> {
  name: string
  execute(args: TArgs, context?: ServerToolContext): Promise<TResult>
  /** Optional Zod schema for input validation */
  inputSchema?: z.ZodType<TArgs>
  /** Optional Zod schema for output validation */
  outputSchema?: z.ZodType<TResult>
}
