import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { findCause } from '@sim/utils/errors'
import { defineAuthorizedWorkspaceUseCase, ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { workspacePermissionOperations } from '@/lib/workspaces/application/operations'
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

const STORE_FAILURE_CODES: Partial<Record<number, OrchestrationErrorCode>> = {
  400: 'validation',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
}

/**
 * The caller-safe failure a store error stands for, or the error itself when it
 * names nothing a caller may see: the store's typed errors promise caller-safe
 * wording, driver failures stay private. A coded refusal the HTTP error wraps
 * keeps its code (`SCIM_MANAGED_MEMBERSHIP`), and the HTTP error stays the
 * `cause` the internal route renders.
 */
function callerSafeStoreFailure(error: unknown): unknown {
  const httpError = findCause(
    error,
    (cause): cause is HttpError =>
      cause instanceof HttpError && STORE_FAILURE_CODES[cause.statusCode] !== undefined
  )
  const code = httpError && STORE_FAILURE_CODES[httpError.statusCode]
  if (!httpError || !code) return error
  const refusal = findCause(
    httpError.cause,
    (cause): cause is ForbiddenOperationError => cause instanceof ForbiddenOperationError
  )
  const failure = refusal
    ? new ForbiddenOperationError(refusal.detailCode, httpError.message)
    : new OrchestrationError(code, httpError.message)
  failure.cause = httpError
  return failure
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
 * One member's role change through the same operation and store as
 * {@link updateWorkspacePermissions}, answered with the member as the roster
 * shows them; requesting the current role changes and audits nothing. The
 * member is read before the write so a failed read cannot leave a committed,
 * unaudited change.
 */
export const updateWorkspaceMember = defineAuthorizedWorkspaceUseCase({
  operation: workspacePermissionOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspaceMemberInput }) => resolveContext({ input }),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const member = await getPublicWorkspaceMember(context.workspaceId, input.userId)
    if (!member) throw new OrchestrationError('not_found', 'Member not found')
    const changes = await applyPermissionUpdates(context.workspaceId, principal, [
      { userId: input.userId, permissions: input.role },
    ])
    return { changes, member: { ...member, role: input.role } }
  },
  projectAudit: ({ context, result }) =>
    projectPermissionChangeAudit(context.workspaceId, result.changes),
  afterSuccess: ({ principal, context }) =>
    reconcileWorkspacePermissionCredentials(context.workspaceId, actorUserId(principal)),
})
