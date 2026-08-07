import type { DelegatedPrincipal } from '@sim/auth/principal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

const FILE_DELEGATION_TTL_MS = 5 * 60 * 1000

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
  fileId: string
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

  const issuedAt = new Date()
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId,
    delegationId: `copilot-tool:${context.toolCallId}`,
    audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + FILE_DELEGATION_TTL_MS),
    resourceScope: {
      fileId,
      ...(context.chatId ? { chatId: context.chatId } : {}),
      ...(context.executionId ? { executionId: context.executionId } : {}),
    },
  }
}

export function messageForCopilotFileError(error: unknown): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') return classified.message
  return 'Failed to rename file'
}
