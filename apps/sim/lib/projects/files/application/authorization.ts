import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { copilotChats, user, type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getActivelyBannedUserIds, isAccountBlocked } from '@/lib/auth/ban'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import { requireOrganizationSubjectMembership } from '@/lib/core/application/organization-authorization'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import {
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  requireUserCredentialCapabilities,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { loadProjectAccess } from '@/lib/projects/application/authorization'
import { resolveCopilotProjectScope } from '@/lib/projects/application/discovery'
import {
  PROJECT_FILE_DELEGATION_TTL_MS,
  type ProjectFileOperation,
  type ProjectFilePrincipal,
  projectFileOperations,
} from '@/lib/projects/files/application/operations'
import { requireProjectFileApiEnabled } from '@/lib/projects/rollout.server'
import { resolveFileOwner } from '@/lib/workspace-files/ownership'

export interface ProjectFileTarget {
  projectId: string
  fileId?: string
}

export interface ProjectFileAuthorizationContext {
  projectId: string
  organizationId: string | null
  ownerUserId: string
  owner: { entityType: 'project'; entityId: string }
  canWrite: boolean
  visibleWorkspaceIds: readonly string[]
  file?: WorkspaceFileRow
}

function requirePrincipal(
  principal: Principal,
  operation: ProjectFileOperation,
  input: ProjectFileTarget
): asserts principal is ProjectFilePrincipal {
  if (!Object.values(projectFileOperations).some((registered) => registered === operation)) {
    throw new Error('Unregistered Project file operation')
  }
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  }
  requireOAuthOperationScope(principal, operation)
  if (operation.target === 'file' && !input.fileId) {
    throw new OrchestrationError('validation', 'File ID is required')
  }
  if (operation.target !== 'file' && input.fileId !== undefined) {
    throw new OrchestrationError('validation', 'This operation targets the Project file collection')
  }
  if (principal.kind === 'resource_delegated') {
    requireResourceDelegation(principal, {
      audience: operation.delegationAudience,
      services: operation.delegatedServices,
      scope:
        operation.target === 'collection_observation'
          ? {
              kind: 'file_collection_observation',
              entityType: 'project',
              entityId: input.projectId,
            }
          : {
              kind: 'entity',
              entityType: 'project',
              entityId: input.projectId,
              ...(input.fileId ? { fileId: input.fileId } : {}),
            },
      maxTtlMs: PROJECT_FILE_DELEGATION_TTL_MS,
    })
  }
}

/** Rechecks canonical conversation ownership and authoring capability while authorization locks are held. */
export async function requireCurrentCopilotProjectInvocation(
  tx: DbTransaction,
  principal: Extract<ProjectFilePrincipal, { kind: 'resource_delegated'; serviceId: 'copilot' }>,
  access: Awaited<ReturnType<typeof loadProjectAccess>>,
  scope: Awaited<ReturnType<typeof resolveCopilotProjectScope>>
) {
  if (
    (scope.projectId && scope.projectId !== access.record.id) ||
    (scope.organizationId && scope.organizationId !== access.record.organizationId)
  ) {
    throw new OrchestrationError('not_found', 'Project not found in this conversation')
  }
  let workspaceId: string | null
  if (principal.invocation.kind === 'chat') {
    const [chat] = await tx
      .select({
        userId: copilotChats.userId,
        workspaceId: copilotChats.workspaceId,
        organizationId: copilotChats.organizationId,
        type: copilotChats.type,
        mode: conversationModeSelection,
      })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, principal.invocation.chatId), isNull(copilotChats.deletedAt)))
      .for('share')
      .limit(1)
    if (
      !chat ||
      chat.userId !== principal.subjectUserId ||
      Boolean(chat.workspaceId) === Boolean(chat.organizationId)
    ) {
      throw new OrchestrationError('not_found', 'Chat not found')
    }
    if (chat.organizationId) {
      if (
        chat.organizationId !== scope.organizationId ||
        chat.organizationId !== access.record.organizationId ||
        chat.type !== 'mothership' ||
        (chat.mode !== 'agent' && chat.mode !== 'plan')
      ) {
        throw new OrchestrationError('not_found', 'Project not found in this conversation')
      }
      await requireOrganizationSubjectMembership(
        principal.subjectUserId,
        chat.organizationId,
        'member',
        'copilot.use',
        undefined,
        { executor: tx }
      )
      return
    }
    workspaceId = chat.workspaceId
  } else {
    workspaceId = principal.invocation.workspaceId
  }
  if (!workspaceId || !access.visible.some((row) => row.id === workspaceId)) {
    throw new OrchestrationError('not_found', 'Project not found in this conversation')
  }
  await assertWorkspaceCapability(
    principal.subjectUserId,
    workspaceId,
    'copilot.use',
    access.record.organizationId,
    tx
  )
}

/** Shared owner policy keeps compound copies subject to the same live Project edit rule. */
export async function requireProjectFileOwnerRole(
  tx: DbTransaction,
  userId: string,
  access: Awaited<ReturnType<typeof loadProjectAccess>>,
  accessMode: 'read' | 'write'
): Promise<ProjectFileAuthorizationContext> {
  if (access.record.archivedAt) throw new OrchestrationError('conflict', 'Project is archived')
  const [actor] = await tx
    .select({ banned: user.banned, banExpires: user.banExpires, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, userId))
    .for('share')
    .limit(1)
  if (!actor || isAccountBlocked(actor))
    throw new OrchestrationError('forbidden', 'User account is suspended')
  const canWrite =
    access.orgAdmin ||
    access.rows.some((row) => row.permission === 'admin') ||
    (access.active.length > 0 &&
      access.active.every((row) => row.permission === 'write' || row.permission === 'admin'))
  if (accessMode === 'write' && !canWrite) {
    throw new OrchestrationError(
      'forbidden',
      'Project file editing requires admin access in an environment or write access in every active environment'
    )
  }
  return {
    projectId: access.record.id,
    organizationId: access.record.organizationId,
    ownerUserId: access.record.ownerId,
    owner: { entityType: 'project', entityId: access.record.id },
    canWrite,
    visibleWorkspaceIds: access.visible.map((environment) => environment.id),
  }
}

/** Credential and Files capability checks apply to every currently visible environment. */
export async function requireProjectFileOwnerCapabilities(
  tx: DbTransaction,
  principal: ProjectFilePrincipal,
  access: Awaited<ReturnType<typeof loadProjectAccess>>,
  capability: ProjectFileOperation['capability']
): Promise<void> {
  const userId = requirePrincipalSubjectUserId(principal)
  for (const environment of access.visible) {
    const context = {
      workspaceId: environment.id,
      workspaceOrganizationId: access.record.organizationId,
      allowPersonalApiKeys: environment.allowPersonalApiKeys,
    }
    if (principal.kind === 'personal_api_key' || principal.kind === 'oauth_access_token') {
      if (!context.allowPersonalApiKeys) throw new PersonalApiKeysDisabledError()
      await requireUserCredentialCapabilities(principal, context, tx)
    }
    // permission-group-enforced: files.use — every accessible active environment applies, independent of Issues.
    await assertWorkspaceCapability(
      userId,
      environment.id,
      capability,
      access.record.organizationId,
      tx
    )
  }
}

/** Prepares trusted invocation outside the transaction; the returned closure rechecks authority inside it. */
export async function createProjectFileAuthorizer(
  principal: Principal,
  operation: ProjectFileOperation,
  input: ProjectFileTarget
): Promise<(tx: DbTransaction) => Promise<ProjectFileAuthorizationContext>> {
  requirePrincipal(principal, operation, input)
  requireProjectFileApiEnabled()
  const userId = requirePrincipalSubjectUserId(principal)
  if ((await getActivelyBannedUserIds([userId])).length) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  const invocationScope =
    principal.kind === 'resource_delegated' && principal.serviceId === 'copilot'
      ? await resolveCopilotProjectScope(principal)
      : undefined

  return async (tx) => {
    requirePrincipal(principal, operation, input)
    const access = await loadProjectAccess(tx, userId, { projectId: input.projectId })
    const context = await requireProjectFileOwnerRole(tx, userId, access, operation.access)
    let file: WorkspaceFileRow | undefined
    if (operation.target === 'file') {
      const query = tx
        .select()
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.id, input.fileId ?? ''),
            'fileScope' in operation && operation.fileScope === 'all'
              ? undefined
              : isNull(workspaceFiles.deletedAt)
          )
        )
      const rows = await (operation.access === 'write' ? query : query.for('share')).limit(1)
      file = rows[0]
      const owner = file ? resolveFileOwner(file) : null
      if (!owner || owner.entityType !== 'project' || owner.entityId !== access.record.id) {
        throw new OrchestrationError('not_found', 'File not found')
      }
    }
    if (access.record.organizationId)
      await acquirePermissionGroupOrgLock(tx, access.record.organizationId)
    if (principal.kind === 'resource_delegated' && principal.serviceId === 'copilot') {
      if (!invocationScope) throw new Error('Copilot Project invocation was not prepared')
      await requireCurrentCopilotProjectInvocation(tx, principal, access, invocationScope)
    }
    await requireProjectFileOwnerCapabilities(tx, principal, access, operation.capability)
    return {
      ...context,
      ...(file ? { file } : {}),
    }
  }
}
