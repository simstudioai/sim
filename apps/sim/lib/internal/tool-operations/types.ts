import type { Principal } from '@sim/auth/principal'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import type { InternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import type { ExecutorDelegationOrigin } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { ToolResponse } from '@/tools/types'

/** Typed implementation used by a registered internal tool operation handler. */
export type InternalToolOperationImplementation<P> = (
  params: P,
  signal?: AbortSignal,
  context?: InternalToolOperationContext
) => Promise<ToolResponse> | ToolResponse

/** A service-account credential the executor authorized, and the tool service it was bound to. */
export interface AuthorizedServiceAccountCredential {
  credentialId: string
  service: string
}

/** Trusted runtime scope shared by every in-process tool operation. */
export interface InternalToolOperationContext {
  workflowId: string
  workspaceId?: string
  organizationId?: string
  executionId?: string
  userId?: string
  executorDelegationOrigin?: ExecutorDelegationOrigin
  /**
   * The saved service-account credential the executor authorized for this call,
   * set only from its own credential resolution, never from tool input.
   * Operations that resolve a credential server-side (AWS session keys) read it.
   */
  authorizedServiceAccountCredential?: AuthorizedServiceAccountCredential
  /** Trusted source block for saved MCP operation restrictions. */
  mcpBlockId?: string
  /**
   * Authenticated direct caller, supplied by an authorized use case, never tool input. A
   * delegated principal carries that use case's audience; rebind it before another use case.
   */
  callerPrincipal?: Principal
  copilotToolExecution?: boolean
  copilotInteractionMode?: 'interactive' | 'headless'
  requestMode?: string
  chatId?: string
  toolCallId?: string
  billingAttribution?: BillingAttributionSnapshot
  callChain?: string[]
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
}

export interface InternalToolOperationCall {
  toolId: string
  input?: unknown
  headers: Headers
  context: InternalToolOperationContext
  requestId: string
  signal?: AbortSignal
}

export type InternalToolOperationResult = Response | InternalToolFileResult

export type InternalToolOperationHandler<Result = Response> = (
  request: InternalToolOperationCall
) => Promise<Result>
