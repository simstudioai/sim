import type { OrganizationDelegatedPrincipal, SubjectDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, project, workspace } from '@sim/db/schema'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { and, eq, isNull } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { requireCurrentHumanRole } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import type {
  MemoryNotesAccessInput,
  MemoryNotesAccessResult,
} from '@/lib/mothership/generated/memory-notes-access'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
import { loadProjectAccess } from '@/lib/projects/application/authorization'
import {
  requireCurrentCopilotProjectInvocation,
  requireProjectFileOwnerCapabilities,
  requireProjectFileOwnerRole,
} from '@/lib/projects/files/application/authorization'
import { isProjectsEnabled, requireProjectApiEnabled } from '@/lib/projects/rollout.server'
import { requireCurrentFileSubject } from '@/lib/workspace-files/application/subject'

export const MEMORY_NOTES_ACCESS_AUDIENCE = 'sim:memory-access'
export const resolveMemoryNotesAccessOperation = defineWorkspaceOperation({
  id: 'mothership.memories.resolve_access',
  contentDelivery: 'none',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})
const organizationOperation = defineOrganizationOperation({
  id: resolveMemoryNotesAccessOperation.id,
  contentDelivery: resolveMemoryNotesAccessOperation.contentDelivery,
  minimumRole: 'member',
  capability: 'copilot.use',
  principalKinds: ['organization_delegated'],
  delegatedServices: ['copilot'],
  delegationAudience: MEMORY_NOTES_ACCESS_AUDIENCE,
})
type MemoryPrincipal = SubjectDelegatedPrincipal | OrganizationDelegatedPrincipal
/** The worker acts on the answer after commit, so a consistent unlocked snapshot is enough. */
const READ_SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const

async function workspaceProject(tx: DbTransaction, workspaceId: string) {
  const [row] = await tx
    .select({ id: project.id, organizationId: project.organizationId })
    .from(workspace)
    .innerJoin(project, eq(project.id, workspace.projectId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row ?? null
}

async function workspaceAccess(tx: DbTransaction, userId: string, workspaceId: string) {
  const [target] = await tx
    .select({
      workspaceId: workspace.id,
      name: workspace.name,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  if (!target) throw new OrchestrationError('not_found', 'Workspace not found')
  const permission = await requireCurrentHumanRole(userId, target, 'read', { executor: tx })
  await assertWorkspaceCapability(
    userId,
    workspaceId,
    'copilot.use',
    target.workspaceOrganizationId,
    tx
  )
  return { target, sharedMutation: permissionSatisfies(permission, 'write') }
}

async function projectAccess(
  tx: DbTransaction,
  principal: MemoryPrincipal,
  chatId: string,
  projectId: string,
  scope: { organizationId: string | null; workspaceId?: string }
): Promise<Extract<MemoryNotesAccessResult['target'], { scope: 'project' }>> {
  const access = await loadProjectAccess(
    tx,
    principal.subjectUserId,
    {
      projectId,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
    },
    'snapshot'
  )
  if (scope.organizationId !== access.record.organizationId)
    throw new OrchestrationError('not_found', 'Project not found in this conversation')
  await requireCurrentCopilotProjectInvocation(
    tx,
    {
      subjectUserId: principal.subjectUserId,
      invocation: { kind: 'chat', chatId },
    },
    access,
    scope,
    'snapshot'
  )
  const owner = await requireProjectFileOwnerRole(tx, principal, access, 'read', 'snapshot')
  let sharedMutation = owner.canWrite
  if (sharedMutation) {
    try {
      await requireProjectFileOwnerCapabilities(tx, principal, access, 'files.use')
    } catch (error) {
      if (!(error instanceof PermissionGroupCapabilityError)) throw error
      sharedMutation = false
    }
  }
  return {
    scope: 'project',
    id: access.record.id,
    name: access.record.name,
    permissions: { read: true, privateMutation: true, sharedMutation },
  }
}

/** Current Sim authority only; Mothership must re-resolve before each read or mutation. */
const resolveAccess = defineAuthorizedChatUseCase({
  operation: resolveMemoryNotesAccessOperation,
  organizationOperation,
  async resolveContext({
    principal,
  }: {
    principal: MemoryPrincipal
    input: MemoryNotesAccessInput
  }) {
    const chatId =
      principal.resourceScope && 'chatId' in principal.resourceScope
        ? principal.resourceScope.chatId
        : undefined
    const now = Date.now()
    if (
      principal.serviceId !== 'copilot' ||
      principal.audience !== MEMORY_NOTES_ACCESS_AUDIENCE ||
      !chatId ||
      !Number.isFinite(principal.issuedAt.getTime()) ||
      !Number.isFinite(principal.expiresAt.getTime()) ||
      principal.issuedAt.getTime() > now ||
      principal.expiresAt.getTime() <= now ||
      principal.expiresAt.getTime() - principal.issuedAt.getTime() > 60_000
    )
      throw new OrchestrationError('forbidden', 'Memory delegation is no longer valid')
    return resolveOwnedChatContext(principal, chatId)
  },
  authorizationOptions: {
    delegation: {
      audience: MEMORY_NOTES_ACCESS_AUDIENCE,
      isWithinScope: (principal, context) => principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ principal, context, input }): Promise<MemoryNotesAccessResult> {
    const projectsEnabled = input.target.scope !== 'personal' && (await isProjectsEnabled())
    return db.transaction(async (tx) => {
      await requireCurrentFileSubject(tx, principal, 'snapshot')
      const [chat] = await tx
        .select({
          userId: copilotChats.userId,
          workspaceId: copilotChats.workspaceId,
          organizationId: copilotChats.organizationId,
          type: copilotChats.type,
          mode: conversationModeSelection,
        })
        .from(copilotChats)
        .where(and(eq(copilotChats.id, context.chatId), isNull(copilotChats.deletedAt)))
        .limit(1)
      if (
        !chat ||
        chat.userId !== principal.subjectUserId ||
        chat.workspaceId !== (context.workspaceId ?? null) ||
        chat.organizationId !== (context.organizationId ?? null) ||
        (chat.organizationId && chat.type !== 'mothership')
      )
        throw new OrchestrationError('not_found', 'Chat not found')
      if (chat.organizationId) {
        if (chat.mode !== 'agent' && chat.mode !== 'plan')
          throw new OrchestrationError(
            'forbidden',
            'Memory access requires organization agent mode'
          )
        await authorizeOrganizationOperation(
          principal,
          organizationOperation,
          { organizationId: chat.organizationId },
          { executor: tx }
        )
      }
      const origin =
        chat.workspaceId && input.target.scope !== 'personal'
          ? await workspaceProject(tx, chat.workspaceId)
          : null
      const originAccess = chat.workspaceId
        ? await workspaceAccess(tx, principal.subjectUserId, chat.workspaceId)
        : null
      const scope = {
        organizationId: chat.organizationId ?? origin?.organizationId ?? null,
        ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      }
      let target: MemoryNotesAccessResult['target']
      if (input.target.scope === 'personal') {
        target = {
          scope: 'personal',
          permissions: { read: true, privateMutation: true, sharedMutation: false },
        }
      } else if (input.target.scope === 'project') {
        if (!projectsEnabled) await requireProjectApiEnabled()
        if (chat.workspaceId && origin?.id !== input.target.projectId)
          throw new OrchestrationError('not_found', 'Project not found in this conversation')
        target = await projectAccess(tx, principal, context.chatId, input.target.projectId, scope)
      } else {
        if (chat.workspaceId && chat.workspaceId !== input.target.workspaceId)
          throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
        const membership = chat.workspaceId
          ? origin
          : await workspaceProject(tx, input.target.workspaceId)
        if (!membership || membership.organizationId !== scope.organizationId)
          throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
        const access =
          originAccess ??
          (await workspaceAccess(tx, principal.subjectUserId, input.target.workspaceId))
        if (access.target.workspaceOrganizationId !== scope.organizationId)
          throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
        const currentProject = projectsEnabled
          ? await projectAccess(tx, principal, context.chatId, membership.id, scope)
          : null
        target = {
          scope: 'workspace',
          id: access.target.workspaceId,
          name: access.target.name,
          permissions: { read: true, privateMutation: true, sharedMutation: access.sharedMutation },
          currentProject,
        }
      }
      if (input.action === 'shared_mutation' && !target.permissions.sharedMutation)
        throw new OrchestrationError('forbidden', 'Shared memory mutation is not permitted')
      return {
        success: true,
        version: 1,
        actor: { userId: principal.subjectUserId, chatId: context.chatId },
        target,
      }
    }, READ_SNAPSHOT)
  },
})

/** Authorization-only callers resolve the same requested target and permission as execution. */
export const resolveMemoryNotesAccess = {
  operation: resolveMemoryNotesAccessOperation,
  execute: resolveAccess.execute,
  async authorize(args: Parameters<typeof resolveAccess.execute>[0]): Promise<void> {
    await resolveAccess.execute(args)
  },
}
