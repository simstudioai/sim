import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import type { OperationUseCase } from '@/lib/core/application/operation'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import { captureServerEvent } from '@/lib/posthog/server'
import { assertMembershipNotScimManaged } from '@/ee/scim/lib/managed-membership'

/** permission-group-exempt: organization administrators must be able to manage membership. */
export const updateOrganizationMemberRoleOperation = defineOrganizationOperation({
  id: 'organization.members.role.update',
  minimumRole: 'admin',
  capability: 'none',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
})

interface MemberRoleInput {
  organizationId: string
  userId: string
  role: OrganizationMembershipContext['role']
}
interface MemberRoleResult {
  id: string
  userId: string
  role: OrganizationMembershipContext['role']
  updatedBy: string
}

/** Shares the locked role transition and directory-management policy with organization settings. */
export const updateOrganizationMemberRole: OperationUseCase<
  typeof updateOrganizationMemberRoleOperation,
  MemberRoleInput,
  MemberRoleResult
> = {
  operation: updateOrganizationMemberRoleOperation,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(
      principal,
      updateOrganizationMemberRoleOperation,
      input
    )
    const [target] = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        email: user.email,
        name: user.name,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(eq(member.organizationId, context.organizationId), eq(member.userId, input.userId))
      )
      .limit(1)
    if (!target) throw new OrchestrationError('not_found', 'Member not found')
    if (target.role === 'owner')
      throw new OrchestrationError('validation', 'Cannot change owner role')
    const { role } = input
    if (role === 'owner')
      throw new OrchestrationError(
        'validation',
        'Ownership transfer is not supported via this endpoint. Use POST /organizations/[id]/transfer-ownership instead.'
      )
    const [actor] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, context.userId))
      .limit(1)
    const change = await db.transaction(async (tx) => {
      await acquireOrganizationUserMutationLocks(tx, {
        userId: input.userId,
        organizationIds: [context.organizationId],
      })
      await assertMembershipNotScimManaged({
        organizationId: context.organizationId,
        userId: input.userId,
        executor: tx,
      })
      return changeMemberRoleTx(tx, {
        organizationId: context.organizationId,
        userId: input.userId,
        role,
      })
    })

    recordAudit({
      workspaceId: null,
      actorId: context.userId,
      actorName: actor?.name ?? undefined,
      actorEmail: actor?.email ?? undefined,
      action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: context.organizationId,
      description: `Changed role for member ${input.userId} to ${input.role}`,
      metadata: {
        operation: updateOrganizationMemberRoleOperation.id,
        actor: resolvePrincipalAuditAttribution(principal).actor,
        targetUserId: input.userId,
        targetEmail: target.email ?? undefined,
        targetName: target.name ?? undefined,
        changes: [
          { field: 'role', from: change.changed ? change.from : change.role, to: input.role },
        ],
      },
      request,
    })
    captureServerEvent(
      context.userId,
      'org_member_role_changed',
      { organization_id: context.organizationId, new_role: input.role },
      { groups: { organization: context.organizationId } }
    )
    return {
      id: target.id,
      userId: target.userId,
      role,
      updatedBy: context.userId,
    }
  },
}
