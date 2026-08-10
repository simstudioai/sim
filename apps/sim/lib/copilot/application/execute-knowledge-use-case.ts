import type { DelegatedPrincipal } from '@sim/auth/principal'
import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createCopilotApplicationPrincipal,
  createTrustedCopilotPrincipal,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import type { OperationUseCase } from '@/lib/core/application'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import {
  type KnowledgeOperation,
  knowledgeOperations,
} from '@/lib/knowledge/application/operations'

export type CopilotKnowledgeDelegationContext = CopilotExecutionContext

export interface CopilotChatKnowledgeDelegationContext {
  userId: string
  workspaceId: string
  chatId?: string
}

const knowledgeDelegation = {
  audience: knowledgeDelegationPolicy.audience,
  ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createDelegationId: (context: Parameters<typeof createCopilotApplicationPrincipal>[0]) =>
    context.toolCallId,
} as const

const executeKnowledgeUseCase = createCopilotApplicationAdapter({
  domain: 'knowledge',
  delegation: knowledgeDelegation,
  operations: knowledgeOperations,
})

/** Requires the immutable trusted workspace bound to a Copilot Knowledge execution. */
export function requireCopilotKnowledgeWorkspaceId(
  context: CopilotKnowledgeDelegationContext | undefined
): string {
  return requireTrustedCopilotExecutionContext(context).workspaceId
}

/** Normalizes immutable Copilot execution identity into a knowledge delegation. */
export function resolveCopilotKnowledgePrincipal(
  context: CopilotKnowledgeDelegationContext | undefined
): DelegatedPrincipal {
  return createCopilotApplicationPrincipal(
    requireTrustedCopilotExecutionContext(context),
    knowledgeDelegation
  )
}

/** Creates the trusted Knowledge principal used while resolving Copilot chat context. */
export function createCopilotChatKnowledgePrincipal(
  context: CopilotChatKnowledgeDelegationContext
): DelegatedPrincipal {
  return createTrustedCopilotPrincipal(
    {
      userId: context.userId,
      workspaceId: context.workspaceId,
      delegationId: `copilot-chat:${context.chatId ?? context.workspaceId}`,
      chatId: context.chatId,
    },
    knowledgeDelegation
  )
}

/** Enters a registered knowledge application use case with trusted Copilot identity. */
export function executeCopilotKnowledgeUseCase<O extends KnowledgeOperation, I, R>(
  context: CopilotKnowledgeDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I
): Promise<R> {
  return executeKnowledgeUseCase(context, useCase, input)
}

/** Projects only caller-actionable application errors into a Copilot result. */
export function messageForCopilotKnowledgeError(
  error: unknown,
  fallback = 'Knowledge operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
