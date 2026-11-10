import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { defineAuthorizedWorkspaceUseCase, ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { workspacePermissionOperations } from '@/lib/workspaces/application/member-operations'
import {
  type WorkspacePermissionUpdate,
  workspacePermissionUpdatesSchema,
} from '@/lib/workspaces/permissions/input'
import {
  reconcileWorkspacePermissionCredentials,
  updateWorkspacePermissionRecords,
} from '@/lib/workspaces/permissions/management-store'
import { getWorkspacePermissionsForViewer } from '@/lib/workspaces/permissions/utils'
import { getPublicWorkspaceMember } from '@/lib/workspaces/public-queries'

export interface ReadWorkspacePermissionsInput {
  workspaceId: string
}

export interface UpdateWorkspacePermissionsInput extends ReadWorkspacePermissionsInput {
  updates: WorkspacePermissionUpdate[]
}

function actorUserId(principal: Principal): string {
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind !== 'sim_user')
    throw new OrchestrationError('forbidden', 'Workspace permission management requires a user')
  return subject.userId
}

const authorizationOptions = {
  delegation: { audience: 'sim:settings', isWithinScope: () => true },
}

function resolveContext({ input }: { input: ReadWorkspacePermissionsInput }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

export const readWorkspacePermissions = defineAuthorizedWorkspaceUseCase({
  operation: workspacePermissionOperations.read,
  resolveContext,
  authorizationOptions,
  async execute({ principal, context }) {
    const result = await getWorkspacePermissionsForViewer(
      context.workspaceId,
      actorUserId(principal)
    )
    if (!result) throw new OrchestrationError('not_found', 'Workspace not found or access denied')
    return result
  },
})

/**
 * The caller-safe failure a store error stands for, or the error itself when it
 * names nothing a caller may see.
 *
 * This store's typed errors promise caller-safe wording; driver failures remain
 * private. A coded refusal anywhere in the chain wins over the HTTP error that
 * wraps it, so a directory-managed member keeps its `SCIM_MANAGED_MEMBERSHIP`
 * code instead of collapsing into a bare forbidden.
 */
function callerSafeStoreFailure(error: unknown): unknown {
  const chain: Error[] = []
  for (
    let cause: unknown = error;
    cause instanceof Error && !chain.includes(cause);
    cause = cause.cause
  ) {
    chain.push(cause)
  }
  const refusal = chain.find((cause) => cause instanceof ForbiddenOperationError)
  if (refusal) return refusal
  for (const cause of chain) {
    if (!(cause instanceof HttpError)) continue
    const code =
      cause.statusCode === 400
        ? 'validation'
        : cause.statusCode === 403
          ? 'forbidden'
          : cause.statusCode === 404
            ? 'not_found'
            : cause.statusCode === 409
              ? 'conflict'
              : undefined
    if (code) {
      const failure = new OrchestrationError(code, cause.message)
      failure.cause = cause
      return failure
    }
  }
  return error
}

async function applyPermissionUpdates(
  workspaceId: string,
  principal: Principal,
  updates: WorkspacePermissionUpdate[]
) {
  const parsed = workspacePermissionUpdatesSchema.safeParse({ updates })
  if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
  return updateWorkspacePermissionRecords(
    workspaceId,
    actorUserId(principal),
    parsed.data.updates
  ).catch((error: unknown) => {
    throw callerSafeStoreFailure(error)
  })
}

type PermissionChange = Awaited<ReturnType<typeof updateWorkspacePermissionRecords>>[number]

function projectPermissionChangeAudit(workspaceId: string, changes: PermissionChange[]) {
  return changes.map((change) => ({
    action: AuditAction.MEMBER_ROLE_CHANGED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: workspaceId,
    resourceName: change.targetEmail ?? change.targetUserId,
    description: `Changed permissions for ${change.targetEmail ?? change.targetUserId} from ${change.previousRole ?? 'unknown'} to ${change.newRole}`,
    metadata: change,
  }))
}

export const updateWorkspacePermissions = defineAuthorizedWorkspaceUseCase({
  operation: workspacePermissionOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspacePermissionsInput }) =>
    resolveContext({ input }),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const changes = await applyPermissionUpdates(context.workspaceId, principal, input.updates)
    return { message: 'Permissions updated successfully', changes }
  },
  projectAudit: ({ context, result }) =>
    projectPermissionChangeAudit(context.workspaceId, result.changes),
  afterSuccess: ({ principal, context }) =>
    reconcileWorkspacePermissionCredentials(context.workspaceId, actorUserId(principal)),
})

export interface UpdateWorkspaceMemberInput extends ReadWorkspacePermissionsInput {
  userId: string
  role: PermissionType
}

/**
 * One member's role change, answered with that member as the roster shows them
 * afterwards. The same operation and store as {@link updateWorkspacePermissions};
 * a request for the role the member already holds changes and audits nothing.
 *
 * The member is read before the write: audit is projected only once `execute`
 * returns, so a read failing after the commit would leave a durable role change
 * with no audit entry. A successful write leaves exactly the requested role,
 * because the store refuses inherited (organization admin) roles outright.
 */
export const updateWorkspaceMember = defineAuthorizedWorkspaceUseCase({
  operation: workspacePermissionOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspaceMemberInput }) => resolveContext({ input }),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const before = await getPublicWorkspaceMember(context.workspaceId, input.userId)
    const changes = await applyPermissionUpdates(context.workspaceId, principal, [
      { userId: input.userId, permissions: input.role },
    ])
    /** Granted between the read and the locked write; the store vetted them as a member. */
    const member = before ?? (await getPublicWorkspaceMember(context.workspaceId, input.userId))
    if (!member) {
      throw new OrchestrationError(
        'conflict',
        "This member's access just changed. Refresh and try again."
      )
    }
    return { changes, member: { ...member, role: input.role } }
  },
  projectAudit: ({ context, result }) =>
    projectPermissionChangeAudit(context.workspaceId, result.changes),
  afterSuccess: ({ principal, context }) =>
    reconcileWorkspacePermissionCredentials(context.workspaceId, actorUserId(principal)),
})
