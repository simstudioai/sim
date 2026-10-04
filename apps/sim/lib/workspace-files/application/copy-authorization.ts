import {
  type Principal,
  type ResourceFileCopyScope,
  requirePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { projectWorkspace, user, workspace } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { getActivelyBannedUserIds, isAccountBlocked } from '@/lib/auth/ban'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import {
  isResourceFileCopyScope,
  requireResourceDelegation,
} from '@/lib/core/application/resource-delegation'
import {
  authorizeWorkspaceOperation,
  PrincipalKindAuthorizationError,
  requireCurrentHumanRole,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { loadProjectAccess } from '@/lib/projects/application/authorization'
import { resolveCopilotProjectScope } from '@/lib/projects/application/discovery'
import {
  type ProjectFileAuthorizationContext,
  requireCurrentCopilotProjectInvocation,
  requireProjectFileOwnerCapabilities,
  requireProjectFileOwnerRole,
} from '@/lib/projects/files/application/authorization'
import { lockProject, lockProjectBackfillWrites } from '@/lib/projects/membership'
import { requireProjectFileApiEnabled } from '@/lib/projects/rollout.server'
import {
  FILE_COPY_DELEGATION_TTL_MS,
  fileCopyOperation,
} from '@/lib/workspace-files/application/copy-operation'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'

export type CopyFileItemsInput = Omit<ResourceFileCopyScope, 'kind'>

type CopyPrincipal =
  | Extract<Principal, { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }>
  | Extract<Principal, { kind: 'resource_delegated'; serviceId: 'copilot' }>

type ProjectAccess = Awaited<ReturnType<typeof loadProjectAccess>>

export type FileCopyOwnerContext =
  | ProjectFileAuthorizationContext
  | {
      owner: { entityType: 'workspace'; entityId: string }
      workspaceId: string
      organizationId: string | null
      billedAccountUserId: string
    }

export interface FileCopyAuthorizationContext {
  source: FileCopyOwnerContext
  destination: FileCopyOwnerContext
}

interface CopyOwnerPolicyInput {
  tx: DbTransaction
  principal: CopyPrincipal
  userId: string
  owner: ResourceFileCopyScope['source']['owner']
  mode: 'read' | 'write'
  projects: ReadonlyMap<string, ProjectAccess>
  workspaces: ReadonlyMap<string, typeof workspace.$inferSelect>
}

type CopyOwnerPolicy = (input: CopyOwnerPolicyInput) => Promise<FileCopyOwnerContext>

const COPY_OWNER_POLICIES: FileOwnerAdapters<CopyOwnerPolicy> = {
  async project({ tx, principal, userId, owner, mode, projects }) {
    const access = projects.get(owner.entityId)
    if (!access) throw new OrchestrationError('not_found', 'Project not found')
    const context = await requireProjectFileOwnerRole(tx, userId, access, mode)
    await requireProjectFileOwnerCapabilities(tx, principal, access, fileCopyOperation.capability)
    return context
  },
  async workspace({ tx, principal, userId, owner, mode, workspaces }) {
    const row = workspaces.get(owner.entityId)
    if (!row) throw new OrchestrationError('not_found', 'Workspace not found')
    const context = {
      workspaceId: row.id,
      workspaceOrganizationId: row.organizationId,
      allowPersonalApiKeys: row.allowPersonalApiKeys,
    }
    // Project access already holds membership and permission SHARE locks; upgrading can deadlock other Projects.
    if (principal.kind === 'resource_delegated') {
      await requireCurrentHumanRole(userId, context, mode, { executor: tx })
      // permission-group-enforced: files.use — copy delegation retains the subject's workspace file policy.
      await assertWorkspaceCapability(
        userId,
        row.id,
        fileCopyOperation.capability,
        row.organizationId,
        tx
      )
    } else {
      await authorizeWorkspaceOperation(
        principal,
        mode === 'read' ? fileOperations.list : fileOperations.create,
        context,
        { executor: tx }
      )
    }
    return {
      owner: { entityType: 'workspace', entityId: row.id },
      workspaceId: row.id,
      organizationId: row.organizationId,
      billedAccountUserId: row.billedAccountUserId,
    }
  },
}

function requireCopyPrincipal(
  principal: Principal,
  input: CopyFileItemsInput
): asserts principal is CopyPrincipal {
  if (!fileCopyOperation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new PrincipalKindAuthorizationError(principal.kind, fileCopyOperation.id)
  }
  const scope = { kind: 'file_copy', ...input }
  if (!isResourceFileCopyScope(scope)) {
    throw new OrchestrationError(
      'validation',
      'Copy requires bounded source and destination owners'
    )
  }
  requireOAuthOperationScope(principal, fileCopyOperation)
  if (principal.kind === 'resource_delegated') {
    requireResourceDelegation(principal, {
      audience: fileCopyOperation.delegationAudience,
      services: fileCopyOperation.delegatedServices,
      scope,
      maxTtlMs: FILE_COPY_DELEGATION_TTL_MS,
    })
  }
}

/** Authorizes both owners under canonical locks; selected rows remain the copy manager's responsibility. */
export async function createFileCopyAuthorizer(
  principal: Principal,
  input: CopyFileItemsInput
): Promise<(tx: DbTransaction) => Promise<FileCopyAuthorizationContext>> {
  requireCopyPrincipal(principal, input)
  requireProjectFileApiEnabled()
  // actorless-unsupported: files.copy rejects executors and workspace keys; both owner policies require the acting human.
  const userId = requirePrincipalSubjectUserId(principal)
  if ((await getActivelyBannedUserIds([userId])).length) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  const invocationScope =
    principal.kind === 'resource_delegated'
      ? await resolveCopilotProjectScope(principal)
      : undefined

  return async (tx) => {
    requireCopyPrincipal(principal, input)
    const actingPrincipal = principal
    const owners = [input.source.owner, input.destination.owner]
    const workspaceIds = [
      ...new Set(
        owners.filter((owner) => owner.entityType === 'workspace').map((owner) => owner.entityId)
      ),
    ].sort(compareStrings)
    await lockProjectBackfillWrites(tx, workspaceIds)
    const memberships = workspaceIds.length
      ? await tx
          .select()
          .from(projectWorkspace)
          .where(inArray(projectWorkspace.workspaceId, workspaceIds))
      : []
    const parents = new Map(memberships.map((row) => [row.workspaceId, row.projectId]))
    if (workspaceIds.some((workspaceId) => !parents.has(workspaceId))) {
      throw new OrchestrationError('not_found', 'Workspace not found in a Project')
    }
    const projectIds = [
      ...new Set([
        ...owners.filter((owner) => owner.entityType === 'project').map((owner) => owner.entityId),
        ...parents.values(),
      ]),
    ].sort(compareStrings)
    for (const projectId of projectIds) await lockProject(tx, projectId)
    const currentMemberships = workspaceIds.length
      ? await tx
          .select()
          .from(projectWorkspace)
          .where(inArray(projectWorkspace.workspaceId, workspaceIds))
      : []
    if (
      currentMemberships.length !== memberships.length ||
      currentMemberships.some((row) => parents.get(row.workspaceId) !== row.projectId)
    ) {
      throw new OrchestrationError('conflict', 'Project membership changed; retry the copy')
    }

    const projects = new Map<string, ProjectAccess>()
    for (const projectId of projectIds) {
      projects.set(projectId, await loadProjectAccess(tx, userId, { projectId }))
    }
    const workspaces = workspaceIds.length
      ? await tx
          .select()
          .from(workspace)
          .where(and(inArray(workspace.id, workspaceIds), isNull(workspace.archivedAt)))
          .orderBy(asc(workspace.id))
          .for('share')
      : []
    const workspacesById = new Map(workspaces.map((row) => [row.id, row]))
    const organizationIds = [
      ...new Set(
        [
          ...[...projects.values()].map((access) => access.record.organizationId),
          ...workspaces.map((row) => row.organizationId),
        ].filter((id): id is string => id !== null)
      ),
    ].sort(compareStrings)
    for (const organizationId of organizationIds)
      await acquirePermissionGroupOrgLock(tx, organizationId)
    const [actor] = await tx
      .select({ banned: user.banned, banExpires: user.banExpires, suspendedAt: user.suspendedAt })
      .from(user)
      .where(eq(user.id, userId))
      .for('share')
      .limit(1)
    if (!actor || isAccountBlocked(actor)) {
      throw new OrchestrationError('forbidden', 'User account is suspended')
    }
    if (principal.kind === 'resource_delegated') {
      if (!invocationScope) throw new Error('Copilot copy invocation was not prepared')
      for (const access of projects.values()) {
        await requireCurrentCopilotProjectInvocation(tx, principal, access, invocationScope)
      }
    }

    function authorizeOwner(
      owner: ResourceFileCopyScope['source']['owner'],
      mode: 'read' | 'write'
    ): Promise<FileCopyOwnerContext> {
      return requireFileOwnerAdapter(
        COPY_OWNER_POLICIES,
        owner
      )({
        tx,
        principal: actingPrincipal,
        userId,
        owner,
        mode,
        projects,
        workspaces: workspacesById,
      })
    }

    const source = await authorizeOwner(input.source.owner, 'read')
    const destination = await authorizeOwner(input.destination.owner, 'write')
    return { source, destination }
  }
}
