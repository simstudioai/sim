import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { ExecutorDelegationOrigin } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { ToolResponse } from '@/tools/types'

/** Typed implementation used by a registered internal tool operation handler. */
export type InternalToolOperationImplementation<P> = (
  params: P,
  signal?: AbortSignal,
  context?: InternalToolOperationContext
) => Promise<ToolResponse> | ToolResponse

/** Trusted runtime scope shared by every in-process tool operation. */
export interface InternalToolOperationContext {
  workflowId: string
  workspaceId?: string
  executionId?: string
  userId?: string
  executorDelegationOrigin?: ExecutorDelegationOrigin
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

export type InternalToolOperationHandler = (request: InternalToolOperationCall) => Promise<Response>
