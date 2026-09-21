import { AuditAction, AuditResourceType } from '@sim/audit'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { organizationOperations } from '@/lib/organizations/application/operations'
import {
  removeOrganizationMemberRecord,
  updateOrganizationMemberRecord,
} from '@/lib/organizations/member-manager'

export const updateOrganizationMember = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.updateMember,
  execute: ({
    input,
    context,
  }: {
    input: { organizationId: string; userId: string; role: 'member' | 'admin' | 'owner' }
    context: { userId: string }
  }) => updateOrganizationMemberRecord({ ...input, actorUserId: context.userId }),
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: `Changed role for member ${input.userId} to ${input.role}`,
    metadata: {
      targetUserId: input.userId,
      targetEmail: result.member.userEmail,
      targetName: result.member.userName,
      changes: [{ field: 'role', from: result.previousRole, to: input.role }],
    },
  }),
})

export const removeOrganizationMember = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.removeMember,
  authorizeResource: ({ input, context }) => {
    if (!isOrgAdminRole(context.role) && input.userId !== context.userId)
      throw new ForbiddenOperationError(
        'ORGANIZATION_ADMIN_REQUIRED',
        'Forbidden - Insufficient permissions'
      )
  },
  async execute({
    input,
    context,
    principal,
  }: OrganizationUseCaseContext<{ organizationId: string; userId: string }>) {
    const result = await removeOrganizationMemberRecord({
      ...input,
      actorUserId: context.userId,
      ...(principal.kind === 'session' && input.userId === principal.userId
        ? { spareSessionId: principal.sessionId }
        : {}),
    })
    return {
      ...result,
      removedBy: context.userId,
      removedAt: new Date().toISOString(),
      wasSelfRemoval: input.userId === context.userId,
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORG_MEMBER_REMOVED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: result.wasSelfRemoval
      ? 'Left the organization'
      : `Removed member ${input.userId} from organization`,
    metadata: {
      targetUserId: input.userId,
      targetEmail: result.target.userEmail,
      targetName: result.target.userName,
      ...(result.membershipType === 'external'
        ? { membershipType: 'external', ...result.removal }
        : { wasSelfRemoval: result.wasSelfRemoval, seatReduction: result.seatReduction }),
    },
  }),
})
