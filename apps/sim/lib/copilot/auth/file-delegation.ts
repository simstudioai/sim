import type { DelegatedPrincipal } from '@sim/auth/principal'
import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createCopilotApplicationPrincipal,
  createCopilotChatPrincipal,
  createTrustedCopilotPrincipal,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'

export type CopilotFileDelegationContext = CopilotExecutionContext

export interface CopilotChatFileDelegationContext {
  userId: string
  workspaceId: string
  chatId?: string
}

export interface CopilotWorkspaceContextFileDelegationContext
  extends CopilotChatFileDelegationContext {
  executionId?: string
}

const fileDelegation = {
  audience: workspaceFileDelegationPolicy.audience,
  ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createDelegationId: (context: Parameters<typeof createCopilotApplicationPrincipal>[0]) =>
    `copilot-tool:${context.toolCallId}`,
} as const

/** Normalizes a trusted Copilot tool context into the shared file principal. */
export function resolveCopilotFilePrincipal(
  context: CopilotFileDelegationContext | undefined,
  fileId?: string
): DelegatedPrincipal {
  return createCopilotApplicationPrincipal(requireTrustedCopilotExecutionContext(context), {
    ...fileDelegation,
    resourceScope: fileId ? { fileId } : undefined,
  })
}

/** Creates the principal used while resolving user-supplied chat file context. */
export function createCopilotChatFilePrincipal(
  context: CopilotChatFileDelegationContext
): DelegatedPrincipal {
  return createCopilotChatPrincipal(context, workspaceFileDelegationPolicy.audience)
}

/** Creates the principal used while materializing the Copilot workspace index. */
export function createCopilotWorkspaceContextFilePrincipal(
  context: CopilotWorkspaceContextFileDelegationContext
): DelegatedPrincipal {
  return createTrustedCopilotPrincipal(
    {
      userId: context.userId,
      workspaceId: context.workspaceId,
      delegationId: `copilot-workspace-context:${context.chatId ?? context.executionId ?? context.workspaceId}`,
      chatId: context.chatId,
      executionId: context.executionId,
    },
    fileDelegation
  )
}

export function messageForCopilotFileError(
  error: unknown,
  fallback = 'File operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
