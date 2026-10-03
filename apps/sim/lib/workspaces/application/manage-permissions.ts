import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import {
  type WorkspacePermissionUpdate,
  workspacePermissionUpdatesSchema,
} from '@/lib/workspaces/permissions/input'
import {
  reconcileWorkspacePermissionCredentials,
  updateWorkspacePermissionRecords,
} from '@/lib/workspaces/permissions/management-store'
import { getWorkspacePermissionsForViewer } from '@/lib/workspaces/permissions/utils'

export const workspacePermissionOperations = {
  /** permission-group-exempt: the roster describes the workspace the caller belongs to. */
  read: defineWorkspaceOperation({
    id: 'workspaces.permissions.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
  /** permission-group-exempt: workspace administrators manage existing collaborator roles. */
  update: defineWorkspaceOperation({
    id: 'workspaces.permissions.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
} as const

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

export const updateWorkspacePermissions = defineAuthorizedWorkspaceUseCase({
  operation: workspacePermissionOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspacePermissionsInput }) =>
    resolveContext({ input }),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const parsed = workspacePermissionUpdatesSchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
    const changes = await updateWorkspacePermissionRecords(
      context.workspaceId,
      actorUserId(principal),
      parsed.data.updates
    ).catch((error: unknown) => {
      // This store's typed errors promise caller-safe wording; driver failures remain private.
      let cause: unknown = error
      const seen = new Set<Error>()
      while (cause instanceof Error && !seen.has(cause)) {
        seen.add(cause)
        if (cause instanceof HttpError) {
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
            throw failure
          }
        }
        cause = cause.cause
      }
      throw error
    })
    return { message: 'Permissions updated successfully', changes }
  },
  projectAudit: ({ context, result }) =>
    result.changes.map((change) => ({
      action: AuditAction.MEMBER_ROLE_CHANGED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: context.workspaceId,
      resourceName: change.targetEmail ?? change.targetUserId,
      description: `Changed permissions for ${change.targetEmail ?? change.targetUserId} from ${change.previousRole ?? 'unknown'} to ${change.newRole}`,
      metadata: change,
    })),
  afterSuccess: ({ principal, context }) =>
    reconcileWorkspacePermissionCredentials(context.workspaceId, actorUserId(principal)),
})
