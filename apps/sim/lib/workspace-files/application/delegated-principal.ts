import type { WorkspaceDelegatedPrincipal } from '@sim/auth/principal'
import { principalWorkspaceId } from '@sim/auth/principal'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

const WORKSPACE_FILE_DELEGATION_TTL_MS = 5 * 60 * 1000

export interface WorkspaceFileDelegationInput {
  serviceId: WorkspaceDelegatedPrincipal['serviceId']
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
): WorkspaceDelegatedPrincipal {
  if (!input.subjectUserId || !input.workspaceId || !input.delegationId) {
    throw new Error('Workspace file delegation requires subject, workspace, and delegation IDs')
  }
  const issuedAt = new Date()
  const principal = {
    kind: 'delegated' as const,
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
  if (input.serviceId === 'executor') return { ...principal, serviceId: 'executor' }
  const { workspaceId, resourceScope, ...envelope } = principal
  return {
    ...envelope,
    serviceId: input.serviceId,
    invocation: { kind: 'workspace', workspaceId },
    grant: {
      kind: 'entity',
      owner: { entityType: 'workspace', entityId: workspaceId },
      restrictions: resourceScope,
    },
  }
}

export interface RebindWorkspaceFileDelegationInput {
  principal: WorkspaceDelegatedPrincipal
  workspaceId: string
  delegationId: string
  fileId?: string
  chatId?: string
  executionId?: string
}

/** Rebinds an already-authorized service principal without changing its workflow actor. */
export function rebindWorkspaceFileDelegatedPrincipal(
  input: RebindWorkspaceFileDelegationInput
): WorkspaceDelegatedPrincipal {
  if (principalWorkspaceId(input.principal) !== input.workspaceId || !input.delegationId) {
    throw new Error('Workspace file delegation does not match its authorized workspace')
  }
  const issuedAt = new Date()
  const updates = {
    delegationId: input.delegationId,
    audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    issuedAt,
    expiresAt: new Date(
      Math.min(
        input.principal.expiresAt.getTime(),
        issuedAt.getTime() + WORKSPACE_FILE_DELEGATION_TTL_MS
      )
    ),
  }
  const restrictions = {
    ...(input.fileId ? { fileId: input.fileId } : {}),
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
  }
  if (input.principal.serviceId === 'executor')
    return { ...input.principal, ...updates, resourceScope: restrictions }
  return { ...input.principal, ...updates, grant: { ...input.principal.grant, restrictions } }
}
