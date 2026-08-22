import type { DelegatedPrincipal } from '@sim/auth/principal'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

const WORKSPACE_FILE_DELEGATION_TTL_MS = 5 * 60 * 1000

export interface WorkspaceFileDelegationInput {
  serviceId: DelegatedPrincipal['serviceId']
  subjectUserId: string
  workspaceId: string
  delegationId: string
  fileId?: string
  chatId?: string
  executionId?: string
}

/** Binds a trusted service execution to the shared workspace-file principal shape. */
export function createWorkspaceFileDelegatedPrincipal(
  input: WorkspaceFileDelegationInput
): DelegatedPrincipal {
  if (!input.subjectUserId || !input.workspaceId || !input.delegationId) {
    throw new Error('Workspace file delegation requires subject, workspace, and delegation IDs')
  }
  const issuedAt = new Date()
  return {
    kind: 'delegated',
    serviceId: input.serviceId,
    subjectUserId: input.subjectUserId,
    workspaceId: input.workspaceId,
    delegationId: input.delegationId,
    audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + WORKSPACE_FILE_DELEGATION_TTL_MS),
    resourceScope: {
      ...(input.fileId ? { fileId: input.fileId } : {}),
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
    },
  }
}
