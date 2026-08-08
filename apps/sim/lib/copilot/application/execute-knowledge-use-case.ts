import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { OperationUseCase } from '@/lib/core/application'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { createKnowledgeDelegatedPrincipal } from '@/lib/knowledge/application/delegated-principal'
import {
  type KnowledgeOperation,
  knowledgeOperations,
} from '@/lib/knowledge/application/operations'

export interface CopilotKnowledgeDelegationContext {
  userId: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  toolCallId?: string
  copilotToolExecution?: boolean
}

const registeredKnowledgeOperationIds = new Set<string>(
  Object.values(knowledgeOperations).map((operation) => operation.id)
)

/** Normalizes immutable Copilot execution identity into a knowledge delegation. */
export function resolveCopilotKnowledgePrincipal(
  context: CopilotKnowledgeDelegationContext | undefined
): DelegatedPrincipal {
  if (!context) throw new Error('Knowledge delegation requires a Copilot execution context')
  if (!context.copilotToolExecution) {
    throw new Error('Knowledge delegation requires a trusted Copilot execution context')
  }
  if (!context.userId) throw new Error('Knowledge delegation requires an authenticated user ID')
  if (!context.workspaceId) throw new Error('Knowledge delegation requires a workspace ID')
  if (!context.toolCallId) throw new Error('Knowledge delegation requires a tool call ID')

  return createKnowledgeDelegatedPrincipal({
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId: context.workspaceId,
    delegationId: context.toolCallId,
    chatId: context.chatId,
    executionId: context.executionId,
  })
}

/** Enters a registered knowledge application use case with trusted Copilot identity. */
export function executeCopilotKnowledgeUseCase<O extends KnowledgeOperation, I, R>(
  context: CopilotKnowledgeDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I
): Promise<R> {
  if (!registeredKnowledgeOperationIds.has(useCase.operation.id)) {
    throw new Error(`Unregistered Copilot knowledge operation: ${useCase.operation.id}`)
  }
  return useCase.execute({ principal: resolveCopilotKnowledgePrincipal(context), input })
}

/** Projects only caller-actionable application errors into a Copilot result. */
export function messageForCopilotKnowledgeError(
  error: unknown,
  fallback = 'Knowledge operation failed'
): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') return classified.message
  return fallback
}
