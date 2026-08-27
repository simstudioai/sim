import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineAuthorizedCredentialUseCase } from '@/lib/credentials/application/authorized-credential-use-case'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import {
  credentialOperations,
  credentialUserOperations,
} from '@/lib/credentials/application/operations'
import {
  leaveCredentialMembership,
  listCredentialMembers,
  listCredentialMembershipsForUser,
  removeCredentialMember,
  upsertCredentialMember,
} from '@/lib/credentials/members'
import { captureServerEvent } from '@/lib/posthog/server'

interface CredentialMemberResourceInput {
  credentialId: string
}

function resolveSessionCredentialContext(
  _principal: SessionPrincipal,
  input: CredentialMemberResourceInput
) {
  return resolveCredentialApplicationContext(input)
}

export const listCredentialMembersUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.listMembers,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: CredentialMemberResourceInput
  }) => resolveSessionCredentialContext(principal, input),
  authorizationOptions: {},
  async execute({ context }) {
    return { members: await listCredentialMembers(context.credential) }
  },
})

export interface UpsertCredentialMemberInput extends CredentialMemberResourceInput {
  userId: string
  role: 'admin' | 'member'
}

export const upsertCredentialMemberUseCase = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.upsertMember,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: UpsertCredentialMemberInput
  }) => resolveSessionCredentialContext(principal, input),
  async execute({ principal, input, context }) {
    const result = await upsertCredentialMember({
      credential: context.credential,
      actorUserId: requirePrincipalSubjectUserId(principal),
      targetUserId: input.userId,
      role: input.role,
    })
    return { ...result, targetUserId: input.userId, role: input.role }
  },
  projectAudit: ({ context, result }) => ({
    action: result.created
      ? AuditAction.CREDENTIAL_MEMBER_ADDED
      : AuditAction.CREDENTIAL_MEMBER_ROLE_CHANGED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credential.id,
    description: result.created
      ? `Shared credential with member as "${result.role}"`
      : `Changed credential member role to "${result.role}"`,
    metadata: {
      targetUserId: result.targetUserId,
      ...(result.created
        ? { role: result.role }
        : { fromRole: result.previousRole, toRole: result.role }),
    },
  }),
  afterSuccess: ({ principal, context, result }) => {
    if (!result.created) return
    captureServerEvent(requirePrincipalSubjectUserId(principal), 'credential_shared', {
      credential_type: context.credential.type,
      role: result.role,
      workspace_id: context.workspaceId,
    })
  },
})

export interface RemoveCredentialMemberInput extends CredentialMemberResourceInput {
  userId: string
}

export const removeCredentialMemberUseCase = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.removeMember,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: RemoveCredentialMemberInput
  }) => resolveSessionCredentialContext(principal, input),
  async execute({ input, context }) {
    await removeCredentialMember({ credential: context.credential, targetUserId: input.userId })
    return { success: true as const, targetUserId: input.userId }
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.CREDENTIAL_MEMBER_REMOVED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credential.id,
    description: 'Removed credential member',
    metadata: { targetUserId: result.targetUserId },
  }),
  afterSuccess: ({ principal, context }) => {
    captureServerEvent(requirePrincipalSubjectUserId(principal), 'credential_unshared', {
      credential_type: context.credential.type,
      workspace_id: context.workspaceId,
    })
  },
})

export const listCredentialMembershipsUseCase = defineAuthorizedCredentialUserUseCase({
  operation: credentialUserOperations.listMemberships,
  async execute({ principal }) {
    return { memberships: await listCredentialMembershipsForUser(principal.userId) }
  },
})

export interface LeaveCredentialMembershipInput {
  credentialId: string
}

export const leaveCredentialMembershipUseCase = defineAuthorizedCredentialUserUseCase({
  operation: credentialUserOperations.leaveMembership,
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: LeaveCredentialMembershipInput
  }) {
    await leaveCredentialMembership({ userId: principal.userId, credentialId: input.credentialId })
    return { success: true as const }
  },
})
