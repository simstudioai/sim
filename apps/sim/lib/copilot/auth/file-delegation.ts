import type { DelegatedPrincipal } from '@sim/auth/principal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

export interface CopilotFileDelegationContext {
  userId: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  toolCallId?: string
  copilotToolExecution?: boolean
}

export interface CopilotChatFileDelegationContext {
  userId: string
  workspaceId: string
  chatId?: string
}

export interface CopilotWorkspaceContextFileDelegationContext
  extends CopilotChatFileDelegationContext {
  executionId?: string
}

/** Normalizes a trusted Copilot tool context into the shared file principal. */
export function resolveCopilotFilePrincipal(
  context: CopilotFileDelegationContext | undefined,
  fileId?: string
): DelegatedPrincipal {
  if (!context) {
    throw new Error('File delegation requires a Copilot execution context')
  }
  if (!context.copilotToolExecution) {
    throw new Error('File delegation requires a trusted Copilot execution context')
  }
  if (!context.toolCallId) {
    throw new Error('File delegation requires a tool call ID')
  }
  if (!context.workspaceId) {
    throw new Error('File delegation requires a workspace ID')
  }

  return createWorkspaceFileDelegatedPrincipal({
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId: context.workspaceId,
    delegationId: `copilot-tool:${context.toolCallId}`,
    fileId,
    chatId: context.chatId,
    executionId: context.executionId,
  })
}

/** Creates the principal used while resolving user-supplied chat file context. */
export function createCopilotChatFilePrincipal(
  context: CopilotChatFileDelegationContext
): DelegatedPrincipal {
  return createWorkspaceFileDelegatedPrincipal({
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId: context.workspaceId,
    delegationId: `copilot-chat:${context.chatId ?? context.workspaceId}`,
    chatId: context.chatId,
  })
}

/** Creates the principal used while materializing the Copilot workspace index. */
export function createCopilotWorkspaceContextFilePrincipal(
  context: CopilotWorkspaceContextFileDelegationContext
): DelegatedPrincipal {
  return createWorkspaceFileDelegatedPrincipal({
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId: context.workspaceId,
    delegationId: `copilot-workspace-context:${context.chatId ?? context.executionId ?? context.workspaceId}`,
    chatId: context.chatId,
    executionId: context.executionId,
  })
}

export function messageForCopilotFileError(
  error: unknown,
  fallback = 'File operation failed'
): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') return classified.message
  return fallback
}
