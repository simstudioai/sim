import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import {
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('OrganizationMemberRemoval')
/** permission-group-exempt: members may leave; administrators manage membership regardless of directory visibility. */
export const removeOrganizationMemberOperation = defineOrganizationOperation({
  id: 'organization.members.remove',
  minimumRole: 'member',
  capability: 'none',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
})
interface RemoveOrganizationMemberInput {
  organizationId: string
  userId: string
}
interface RemoveOrganizationMemberResult {
  success: true
  message: string
  data: {
    removedMemberId: string
    removedBy: string
    removedAt: string
    membershipType?: 'external'
    workspaceAccessRevoked?: number
    permissionGroupsRevoked?: number
    credentialMembershipsRevoked?: number
    pendingInvitationsCancelled?: number
    seatReduction?: Awaited<ReturnType<typeof reconcileOrganizationSeats>>
  }
}

/** Removal keeps the existing billing, workspace-access and live-session lifecycle in one operation. */
export const removeOrganizationMember: OperationUseCase<
  typeof removeOrganizationMemberOperation,
  RemoveOrganizationMemberInput,
  RemoveOrganizationMemberResult
> = {
  operation: removeOrganizationMemberOperation,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(
      principal,
      removeOrganizationMemberOperation,
      input
    )
    const selfRemoval = context.userId === input.userId
    if (!isOrgAdminRole(context.role) && !selfRemoval)
      throw new OrchestrationError('forbidden', 'Forbidden - Insufficient permissions')
    const [target] = await db
      .select({ id: member.id, role: member.role, email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(eq(member.organizationId, context.organizationId), eq(member.userId, input.userId))
      )
      .limit(1)
    const [actor] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, context.userId))
      .limit(1)
    const auditBase = {
      workspaceId: null,
      actorId: context.userId,
      actorName: actor?.name ?? undefined,
      actorEmail: actor?.email ?? undefined,
      action: AuditAction.ORG_MEMBER_REMOVED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: context.organizationId,
      request,
    }
    const data = {
      removedMemberId: input.userId,
      removedBy: context.userId,
      removedAt: new Date().toISOString(),
    }
    if (!target) {
      const [external] = await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1)
      if (!external) throw new OrchestrationError('not_found', 'Member not found')
      const result = await removeExternalUserFromOrganizationWorkspaces({
        userId: input.userId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
      })
      if (!result.success) {
        const message = result.error || 'External workspace member not found'
        throw new OrchestrationError(
          message === 'External workspace member not found'
            ? 'not_found'
            : message === 'User is an organization member'
              ? 'conflict'
              : message === WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR
                ? 'validation'
                : 'internal',
          message
        )
      }
      const counts = {
        workspaceAccessRevoked: result.workspaceAccessRevoked,
        permissionGroupsRevoked: result.permissionGroupsRevoked,
        credentialMembershipsRevoked: result.credentialMembershipsRevoked,
        pendingInvitationsCancelled: result.pendingInvitationsCancelled,
      }
      recordAudit({
        ...auditBase,
        description: `Removed external workspace member ${input.userId} from organization`,
        metadata: {
          operation: removeOrganizationMemberOperation.id,
          actor: resolvePrincipalAuditAttribution(principal).actor,
          targetUserId: input.userId,
          targetEmail: external.email ?? undefined,
          targetName: external.name ?? undefined,
          membershipType: 'external',
          ...counts,
        },
      })
      captureServerEvent(
        context.userId,
        'org_member_removed',
        { organization_id: context.organizationId, is_self_removal: selfRemoval },
        { groups: { organization: context.organizationId } }
      )
      return {
        success: true,
        message: 'External member removed successfully',
        data: { ...data, membershipType: 'external', ...counts },
      }
    }
    const result = await removeUserFromOrganization({
      userId: input.userId,
      organizationId: context.organizationId,
      memberId: target.id,
      actorUserId: context.userId,
      onError: 'throw',
      ...(principal.kind === 'session' && selfRemoval
        ? { spareSessionId: principal.sessionId }
        : {}),
    })
    if (!result.success) {
      const message = result.error || 'Failed to remove organization member'
      throw new OrchestrationError(
        message === 'Cannot remove organization owner' ||
          message === WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR
          ? 'validation'
          : message === 'Member not found'
            ? 'not_found'
            : 'internal',
        message
      )
    }
    let seatReduction: Awaited<ReturnType<typeof reconcileOrganizationSeats>>
    try {
      seatReduction = await reconcileOrganizationSeats({
        organizationId: context.organizationId,
        reason: 'member-removed',
        actorId: context.userId,
      })
    } catch (error) {
      logger.error('Failed to reduce seats after member removal', {
        organizationId: context.organizationId,
        removedMemberId: input.userId,
        error,
      })
      seatReduction = { changed: false, reason: 'Failed to reduce seats after member removal' }
    }
    recordAudit({
      ...auditBase,
      description: selfRemoval
        ? 'Left the organization'
        : `Removed member ${input.userId} from organization`,
      metadata: {
        operation: removeOrganizationMemberOperation.id,
        actor: resolvePrincipalAuditAttribution(principal).actor,
        targetUserId: input.userId,
        targetEmail: target.email ?? undefined,
        targetName: target.name ?? undefined,
        wasSelfRemoval: selfRemoval,
        seatReduction,
      },
    })
    captureServerEvent(
      context.userId,
      'org_member_removed',
      { organization_id: context.organizationId, is_self_removal: selfRemoval },
      { groups: { organization: context.organizationId } }
    )
    return {
      success: true,
      message: selfRemoval ? 'You have left the organization' : 'Member removed successfully',
      data: { ...data, seatReduction },
    }
  },
}
