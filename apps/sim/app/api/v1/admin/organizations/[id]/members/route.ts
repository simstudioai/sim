/**
 * GET /api/v1/admin/organizations/[id]/members
 *
 * List all members of an organization with their billing info.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminMemberDetail>
 *
 * POST /api/v1/admin/organizations/[id]/members
 *
 * Add a user to an organization with full billing logic.
 * Validates seat availability before adding (uses same logic as invitation flow):
 *   - Team plans: checks seats column
 *   - Enterprise plans: checks metadata.seats
 * Handles Pro usage snapshot and subscription cancellation like the invitation flow.
 * If user is already a member, updates their role if different.
 *
 * Body:
 *   - userId: string - User ID to add
 *   - role: string - Role ('admin' | 'member')
 *
 * Response: AdminSingleResponse<AdminMember & {
 *   action: 'created' | 'updated' | 'already_member',
 *   billingActions: { proUsageSnapshotted, proCancelledAtPeriodEnd }
 * }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, user, userStats, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import {
  adminV1AddOrganizationMemberContract,
  adminV1ListOrganizationMembersContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { getOrgMemberLedgerByUser } from '@/lib/billing/core/organization'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { ensureUserInOrganizationTx } from '@/lib/billing/organizations/membership'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import {
  attachOwnedWorkspacesToOrganizationTx,
  ownedAttachableWorkspacesWhere,
} from '@/lib/workspaces/organization-workspaces'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminMember,
  type AdminMemberDetail,
  createPaginationMeta,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationMembersAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1ListOrganizationMembersContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { limit, offset } = parsed.data.query

    try {
      const [orgData] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [countResult, membersData] = await Promise.all([
        db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
        db
          .select({
            id: member.id,
            userId: member.userId,
            organizationId: member.organizationId,
            role: member.role,
            createdAt: member.createdAt,
            userName: user.name,
            userEmail: user.email,
            currentPeriodCost: userStats.currentPeriodCost,
            currentUsageLimit: userStats.currentUsageLimit,
            billingBlocked: userStats.billingBlocked,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .leftJoin(userStats, eq(member.userId, userStats.userId))
          .where(eq(member.organizationId, organizationId))
          .orderBy(member.createdAt)
          .limit(limit)
          .offset(offset),
      ])

      const total = countResult[0].count

      // currentPeriodCost is only a baseline; add each member's attributed
      // usage_log for the org's period so admin shows real current usage.
      const usageByUser = await getOrgMemberLedgerByUser(organizationId)

      const data: AdminMemberDetail[] = membersData.map((m) => ({
        id: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
        userName: m.userName,
        userEmail: m.userEmail,
        currentPeriodCost: (
          Number(m.currentPeriodCost ?? 0) + (usageByUser.get(m.userId) ?? 0)
        ).toString(),
        currentUsageLimit: m.currentUsageLimit,
        billingBlocked: m.billingBlocked ?? false,
      }))

      const pagination = createPaginationMeta(total, limit, offset)

      logger.info(`Admin API: Listed ${data.length} members for organization ${organizationId}`)

      return listResponse(data, pagination)
    } catch (error) {
      logger.error('Admin API: Failed to list organization members', { error, organizationId })
      return internalErrorResponse('Failed to list organization members')
    }
  })
)

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1AddOrganizationMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

    try {
      const { userId, role } = parsed.data.body

      const [orgData] = await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [userData] = await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (!userData) {
        return notFoundResponse('User')
      }

      const [existingMember] = await db
        .select({
          id: member.id,
          role: member.role,
          createdAt: member.createdAt,
          organizationId: member.organizationId,
        })
        .from(member)
        .where(eq(member.userId, userId))
        .limit(1)

      if (existingMember) {
        if (existingMember.organizationId === organizationId) {
          if (existingMember.role === 'owner') {
            return badRequestResponse(
              'Cannot change the owner role via this endpoint. Use POST /api/v1/admin/organizations/[id]/transfer-ownership instead.'
            )
          }

          if (existingMember.role !== role) {
            await db.update(member).set({ role }).where(eq(member.id, existingMember.id))

            logger.info(
              `Admin API: Updated user ${userId} role in organization ${organizationId}`,
              {
                previousRole: existingMember.role,
                newRole: role,
              }
            )

            recordAudit({
              workspaceId: null,
              actorId: 'admin-api',
              action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
              resourceType: AuditResourceType.ORGANIZATION,
              resourceId: organizationId,
              description: `Admin API changed organization member role to ${role}`,
              metadata: { targetUserId: userId, previousRole: existingMember.role, role },
              request,
            })

            return singleResponse({
              id: existingMember.id,
              userId,
              organizationId,
              role,
              createdAt: existingMember.createdAt.toISOString(),
              userName: userData.name,
              userEmail: userData.email,
              action: 'updated' as const,
              billingActions: {
                proUsageSnapshotted: false,
                proCancelledAtPeriodEnd: false,
              },
            })
          }

          return singleResponse({
            id: existingMember.id,
            userId,
            organizationId,
            role: existingMember.role,
            createdAt: existingMember.createdAt.toISOString(),
            userName: userData.name,
            userEmail: userData.email,
            action: 'already_member' as const,
            billingActions: {
              proUsageSnapshotted: false,
              proCancelledAtPeriodEnd: false,
            },
          })
        }

        return badRequestResponse(
          `User is already a member of another organization. Users can only belong to one organization at a time.`
        )
      }

      /**
       * Membership and the workspace sweep commit or roll back together:
       * every workspace the new member owns follows them into the org
       * (collaborators stay external), and an attach failure aborts the whole
       * add instead of leaving a member whose workspaces escaped the sweep.
       * Lock order mirrors invitation acceptance: workspace advisory locks
       * first, then the organization lock inside ensureUserInOrganizationTx.
       */
      const result = await db.transaction(async (tx) => {
        const ownedWorkspaceIds = (
          await tx
            .select({ id: workspace.id })
            .from(workspace)
            .where(ownedAttachableWorkspacesWhere({ userId, includeArchived: true }))
        ).map((row) => row.id)
        if (ownedWorkspaceIds.length > 0) {
          await acquireInvitationMutationLocks(tx, {
            invitationIds: [],
            workspaceIds: ownedWorkspaceIds,
          })
        }

        const membership = await ensureUserInOrganizationTx(tx, {
          userId,
          organizationId,
          role,
          skipBillingLogic: !isBillingEnabled,
        })
        if (!membership.success || !membership.memberId || membership.alreadyMember) {
          return { membership, attachedWorkspaceIds: [], usageLimitUserIds: [] }
        }

        if (ownedWorkspaceIds.length === 0) {
          return { membership, attachedWorkspaceIds: [], usageLimitUserIds: [] }
        }
        const attach = await attachOwnedWorkspacesToOrganizationTx(tx, {
          ownerUserId: userId,
          organizationId,
          workspaceIds: ownedWorkspaceIds,
          externalMemberPolicy: 'external-all',
          ownerMatch: 'owner',
          includeArchived: true,
        })
        return {
          membership,
          attachedWorkspaceIds: attach.attachedWorkspaceIds,
          usageLimitUserIds: attach.usageLimitUserIds,
        }
      })

      if (!result.membership.success || !result.membership.memberId) {
        return badRequestResponse(result.membership.error || 'Failed to add member')
      }
      if (result.membership.alreadyMember) {
        return badRequestResponse('User is already a member of this organization')
      }

      if (result.attachedWorkspaceIds.length > 0) {
        logger.info('Attached new member workspaces to organization', {
          userId,
          organizationId,
          attachedWorkspaceCount: result.attachedWorkspaceIds.length,
        })
      }
      for (const limitUserId of new Set(result.usageLimitUserIds)) {
        try {
          await syncUsageLimitsFromSubscription(limitUserId)
        } catch (syncError) {
          logger.error('Failed to sync usage limits after admin member add', {
            userId: limitUserId,
            organizationId,
            error: syncError,
          })
        }
      }

      const data: AdminMember = {
        id: result.membership.memberId,
        userId,
        organizationId,
        role,
        createdAt: new Date().toISOString(),
        userName: userData.name,
        userEmail: userData.email,
      }

      logger.info(`Admin API: Added user ${userId} to organization ${organizationId}`, {
        role,
        memberId: result.membership.memberId,
        billingActions: result.membership.billingActions,
        attachedWorkspaceCount: result.attachedWorkspaceIds.length,
      })

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORG_MEMBER_ADDED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        description: `Admin API added member to organization as ${role}`,
        metadata: {
          targetUserId: userId,
          role,
          memberId: result.membership.memberId,
          attachedWorkspaceIds: result.attachedWorkspaceIds,
        },
        request,
      })

      return singleResponse({
        ...data,
        action: 'created' as const,
        billingActions: {
          proUsageSnapshotted: result.membership.billingActions.proUsageSnapshotted,
          proCancelledAtPeriodEnd: result.membership.billingActions.proCancelledAtPeriodEnd,
        },
      })
    } catch (error) {
      logger.error('Admin API: Failed to add organization member', { error, organizationId })
      return internalErrorResponse('Failed to add organization member')
    }
  })
)
