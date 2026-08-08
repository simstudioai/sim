import type { DelegatedPrincipal } from '@sim/auth/principal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { createTableDelegatedPrincipal } from '@/lib/table/application/delegated-principal'

export interface CopilotTableDelegationContext {
  userId: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  toolCallId?: string
  copilotToolExecution?: boolean
}

/** Normalizes trusted Copilot execution context into the shared table principal. */
export function resolveCopilotTablePrincipal(
  context: CopilotTableDelegationContext | undefined,
  tableId?: string
): DelegatedPrincipal {
  if (!context) throw new Error('Table delegation requires a Copilot execution context')
  if (!context.copilotToolExecution) {
    throw new Error('Table delegation requires a trusted Copilot execution context')
  }
  if (!context.toolCallId) throw new Error('Table delegation requires a tool call ID')
  if (!context.workspaceId) throw new Error('Table delegation requires a workspace ID')

  return createTableDelegatedPrincipal({
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId: context.workspaceId,
    delegationId: `copilot-tool:${context.toolCallId}`,
    tableId,
    chatId: context.chatId,
    executionId: context.executionId,
  })
}

export function messageForCopilotTableError(
  error: unknown,
  fallback = 'Table operation failed'
): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') return classified.message
  return fallback
}
