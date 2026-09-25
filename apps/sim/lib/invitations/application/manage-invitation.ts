import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalAuditAttribution,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import {
  defineOrganizationOperation,
  type OrganizationOperation,
} from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { getInvitationById } from '@/lib/invitations/core'
import { resendInvitationRecord, revokeInvitationRecord } from '@/lib/invitations/mutation-manager'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const invitationManagementOperations = {
  /** permission-group-exempt: cancellation removes access and remains available when sends are withheld. */
  cancel: defineOrganizationOperation({
    id: 'organization_invitations.cancel',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
  }),
  /** permission-group-exempt: resend checks invitations.send against each canonical admission and workspace scope below. */
  resend: defineOrganizationOperation({
    id: 'organization_invitations.resend',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
  }),
} as const
export interface ManageInvitationInput {
  invitationId: string
  organizationId?: string
  workspaceId?: string
}
export class InvitationManagementError extends OrchestrationError {
  constructor(
    readonly status: number,
    message: string,
    readonly upgradeRequired?: boolean
  ) {
    super(
      status === 400
        ? 'validation'
        : status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : status === 404
              ? 'not_found'
              : status === 409
                ? 'conflict'
                : status === 423
                  ? 'locked'
                  : 'internal',
      message
    )
  }
}
async function managementActor(
  principal: Principal,
  operation: OrganizationOperation,
  input: ManageInvitationInput
) {
  if (principal.kind !== 'session' && principal.kind !== 'organization_delegated')
    throw new OrchestrationError('forbidden', 'Invitation management requires a person')
  if (principal.kind === 'organization_delegated') {
    if (!input.organizationId || input.workspaceId)
      throw new OrchestrationError('forbidden', 'Organization invitation scope is required')
    await authorizeOrganizationOperation(principal, operation, {
      organizationId: input.organizationId,
    })
  }
  return requirePrincipalSubjectUserId(principal)
}

export const cancelInvitation: OperationUseCase<
  typeof invitationManagementOperations.cancel,
  ManageInvitationInput,
  { success: true; invitationCancelled: boolean }
> = {
  operation: invitationManagementOperations.cancel,
  async execute({ principal, input, request }) {
    if (principal.kind === 'session' && input.workspaceId)
      return cancelWorkspaceInvitation.execute({
        principal,
        input: { ...input, workspaceId: input.workspaceId },
        request,
      })
    const actorId = await managementActor(principal, invitationManagementOperations.cancel, input)
    return cancelInvitationWithActor({
      principal,
      input,
      request,
      actorId,
      operation: invitationManagementOperations.cancel,
    })
  },
}

export const resendInvitation: OperationUseCase<
  typeof invitationManagementOperations.resend,
  ManageInvitationInput,
  { success: true }
> = {
  operation: invitationManagementOperations.resend,
  async execute({ principal, input, request }) {
    const actorId = await managementActor(principal, invitationManagementOperations.resend, input)
    return resendInvitationWithActor({
      principal,
      input,
      request,
      actorId,
      operation: invitationManagementOperations.resend,
    })
  },
}

async function cancelInvitationWithActor({
  principal,
  input,
  request,
  actorId,
  operation,
}: InvitationActionContext) {
  const [actor] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, actorId))
    .limit(1)
  const result = await revokeInvitationRecord({
    actorUserId: actorId,
    invitationId: input.invitationId,
    workspaceId: input.workspaceId,
    assertedOrganizationId: input.organizationId,
  })
  const inv = result.invitation
  const scoped = input.workspaceId
  recordAudit({
    workspaceId: scoped ?? inv.grants[0]?.workspaceId ?? null,
    actorId,
    actorName: actor?.name ?? undefined,
    actorEmail: actor?.email ?? undefined,
    action:
      scoped || inv.kind === 'workspace'
        ? AuditAction.INVITATION_REVOKED
        : AuditAction.ORG_INVITATION_REVOKED,
    resourceType:
      scoped || inv.kind === 'workspace'
        ? AuditResourceType.WORKSPACE
        : AuditResourceType.ORGANIZATION,
    resourceId: scoped ?? inv.organizationId ?? inv.grants[0]?.workspaceId ?? input.invitationId,
    description: scoped
      ? `Revoked ${inv.email}'s pending invitation to this workspace`
      : `Cancelled ${inv.kind} invitation for ${inv.email}`,
    metadata: scoped
      ? {
          operation: operation.id,
          actor: resolvePrincipalAuditAttribution(principal).actor,
          invitationId: input.invitationId,
          targetEmail: inv.email,
          workspaceId: scoped,
          invitationCancelled: result.invitationCancelled,
        }
      : {
          operation: operation.id,
          actor: resolvePrincipalAuditAttribution(principal).actor,
          invitationId: input.invitationId,
          targetEmail: inv.email,
          targetRole: inv.role,
          kind: inv.kind,
        },
    request,
  })
  return { success: true as const, invitationCancelled: result.invitationCancelled }
}

async function resendInvitationWithActor({
  principal,
  input,
  request,
  actorId,
  operation,
}: InvitationActionContext) {
  const inv = await getInvitationById(input.invitationId)
  if (!inv || (input.organizationId && inv.organizationId !== input.organizationId))
    throw new InvitationManagementError(404, 'Invitation not found')
  if (input.workspaceId && !inv.grants.some((grant) => grant.workspaceId === input.workspaceId))
    throw new InvitationManagementError(404, 'Invitation not found in this workspace')
  if (
    principal.kind === 'delegated' &&
    inv.grants.some((grant) => grant.workspaceId !== principal.workspaceId)
  )
    throw new InvitationManagementError(
      403,
      'Resend invitations spanning multiple workspaces from organization settings'
    )
  await resendInvitationRecord({
    invitation: inv,
    actorUserId: actorId,
    assertedOrganizationId: input.organizationId,
  })
  recordAudit({
    workspaceId: inv.grants[0]?.workspaceId ?? null,
    actorId,
    action:
      inv.kind === 'workspace' ? AuditAction.INVITATION_RESENT : AuditAction.ORG_INVITATION_RESENT,
    resourceType:
      inv.kind === 'workspace' ? AuditResourceType.WORKSPACE : AuditResourceType.ORGANIZATION,
    resourceId: inv.organizationId ?? inv.grants[0]?.workspaceId ?? inv.id,
    description: `Resent ${inv.kind} invitation to ${inv.email}`,
    metadata: {
      operation: operation.id,
      actor: resolvePrincipalAuditAttribution(principal).actor,
      invitationId: inv.id,
      targetEmail: inv.email,
      targetRole: inv.role,
      kind: inv.kind,
      membershipIntent: inv.membershipIntent,
    },
    request,
  })
  return { success: true as const }
}

interface InvitationActionContext {
  principal: Principal
  input: ManageInvitationInput
  request?: OrchestrationRequestContext
  actorId: string
  operation: ApplicationOperation
}

export interface WorkspaceInvitationActionInput extends ManageInvitationInput {
  workspaceId: string
}

export const workspaceInvitationManagementOperations = {
  /** permission-group-exempt: cancellation withdraws an existing workspace grant. */
  cancel: defineWorkspaceOperation({
    id: 'workspace_invitations.cancel',
    minimumRole: 'admin',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  resend: defineWorkspaceOperation({
    id: 'workspace_invitations.resend',
    minimumRole: 'admin',
    capability: 'invitations.send',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
} as const
const workspaceInvitationAuthorization = {
  delegation: { audience: 'sim:settings', isWithinScope: () => true },
}
function resolveWorkspaceInvitationContext({ input }: { input: WorkspaceInvitationActionInput }) {
  if (!input.workspaceId) throw new OrchestrationError('validation', 'Workspace target is required')
  if (input.organizationId)
    throw new OrchestrationError(
      'validation',
      'Workspace actions do not take an organization target'
    )
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

export const cancelWorkspaceInvitation = defineAuthorizedWorkspaceUseCase({
  operation: workspaceInvitationManagementOperations.cancel,
  resolveContext: resolveWorkspaceInvitationContext,
  authorizationOptions: workspaceInvitationAuthorization,
  execute: ({ principal, input, request }) =>
    cancelInvitationWithActor({
      principal,
      input,
      request,
      actorId: requirePrincipalSubjectUserId(principal),
      operation: workspaceInvitationManagementOperations.cancel,
    }),
})
export const resendWorkspaceInvitation = defineAuthorizedWorkspaceUseCase({
  operation: workspaceInvitationManagementOperations.resend,
  resolveContext: resolveWorkspaceInvitationContext,
  authorizationOptions: workspaceInvitationAuthorization,
  execute: ({ principal, input, request }) =>
    resendInvitationWithActor({
      principal,
      input,
      request,
      actorId: requirePrincipalSubjectUserId(principal),
      operation: workspaceInvitationManagementOperations.resend,
    }),
})
