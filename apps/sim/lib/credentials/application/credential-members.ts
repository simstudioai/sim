import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId, type SessionPrincipal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrdinaryCredentialType } from '@/lib/credentials/access'
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
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
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
  async execute({ principal, context }) {
    if (context.credential.type === 'personal_token') {
      if (context.credential.createdBy !== principal.userId)
        throw new OrchestrationError('not_found', 'Credential not found')
      return { members: [] }
    }
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
      credential_type: requireOrdinaryCredentialType(context.credential.type),
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
      credential_type: requireOrdinaryCredentialType(context.credential.type),
      workspace_id: context.workspaceId,
    })
  },
})

/**
 * Every credential names a workspace (`credential.workspace_id` is NOT NULL), so
 * the rows this user-global listing returns are workspace resources reached
 * without naming a workspace. The endpoint's own gate resolves the caller's
 * organization default group, which is right for the *act* — it belongs to the
 * person, not to any one workspace — but it cannot answer per row.
 *
 * So each row is projected against the group governing **this same user** in the
 * workspace holding that credential. That is the person's own group, not a
 * bystander's: `credentials.list` withholds exactly these rows from them in that
 * workspace under `integrations.manage`, and a listing that names no workspace
 * must not be the way back to what the workspace-scoped listing hides.
 *
 * Only the projection. Leaving a membership stays ungoverned by the workspace
 * group on purpose: it revokes the caller's own access and grants nothing, so
 * gating it would strand a member inside a credential share they can no longer
 * see — the same reasoning that keeps pausing a knowledge connector available
 * after its type leaves the allowlist.
 *
 * The capability is read off the operation rather than spelled out here, so the
 * projection follows the declaration if it is ever renamed.
 */
export const listCredentialMembershipsUseCase = defineAuthorizedCredentialUserUseCase({
  operation: credentialUserOperations.listMemberships,
  async execute({ principal }) {
    const memberships = await listCredentialMembershipsForUser(principal.userId)
    const capability = credentialUserOperations.listMemberships.capability
    if (capability === 'none') return { memberships }
    const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))]
    const withheld = new Set<string>()
    await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        if (await isWorkspaceCapabilityWithheld(principal.userId, workspaceId, capability)) {
          withheld.add(workspaceId)
        }
      })
    )
    return {
      memberships: memberships.filter((membership) => !withheld.has(membership.workspaceId)),
    }
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
