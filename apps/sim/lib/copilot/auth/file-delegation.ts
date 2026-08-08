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

export function createCopilotFilePrincipal(
  context: CopilotFileDelegationContext,
  workspaceId: string,
  fileId?: string
): DelegatedPrincipal {
  if (!context.copilotToolExecution) {
    throw new Error('File delegation requires a trusted Copilot execution context')
  }
  if (!context.toolCallId) {
    throw new Error('File delegation requires a tool call ID')
  }
  if (context.workspaceId !== workspaceId) {
    throw new Error('File delegation workspace does not match the execution context')
  }

  return createWorkspaceFileDelegatedPrincipal({
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId,
    delegationId: `copilot-tool:${context.toolCallId}`,
    fileId,
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
