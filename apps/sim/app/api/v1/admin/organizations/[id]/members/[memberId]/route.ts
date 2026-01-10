/**
 * GET /api/v1/admin/organizations/[id]/members/[memberId]
 *
 * Get member details.
 *
 * Response: AdminSingleResponse<AdminMemberDetail>
 *
 * PATCH /api/v1/admin/organizations/[id]/members/[memberId]
 *
 * Update member role.
 *
 * Body:
 *   - role: string - New role ('admin' | 'member')
 *
 * Response: AdminSingleResponse<AdminMember>
 *
 * DELETE /api/v1/admin/organizations/[id]/members/[memberId]
 *
 * Remove member from organization with full billing logic.
 * Handles departed usage capture and Pro restoration like the regular flow.
 *
 * Query Parameters:
 *   - skipBillingLogic: boolean - Skip billing logic (default: false)
 *
 * Response: { success: true, memberId: string, billingActions: {...} }
 */

import { db } from '@sim/db'
import { member, organization, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminMember, AdminMemberDetail } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationMemberDetailAPI')

interface RouteParams {
  id: string
  memberId: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: organizationId, memberId } = await context.params

  try {
    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [memberData] = await db
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
        lastActive: userStats.lastActive,
        billingBlocked: userStats.billingBlocked,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (!memberData) {
      return notFoundResponse('Member')
    }

    const data: AdminMemberDetail = {
      id: memberData.id,
      userId: memberData.userId,
      organizationId: memberData.organizationId,
      role: memberData.role,
      createdAt: memberData.createdAt.toISOString(),
      userName: memberData.userName,
      userEmail: memberData.userEmail,
      currentPeriodCost: memberData.currentPeriodCost ?? '0',
      currentUsageLimit: memberData.currentUsageLimit,
      lastActive: memberData.lastActive?.toISOString() ?? null,
      billingBlocked: memberData.billingBlocked ?? false,
    }

    logger.info(`Admin API: Retrieved member ${memberId} from organization ${organizationId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get member', { error, organizationId, memberId })
    return internalErrorResponse('Failed to get member')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId, memberId } = await context.params

  try {
    const body = await request.json()

    if (!body.role || !['admin', 'member'].includes(body.role)) {
      return badRequestResponse('role must be "admin" or "member"')
    }

    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [existingMember] = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (!existingMember) {
      return notFoundResponse('Member')
    }

    if (existingMember.role === 'owner') {
      return badRequestResponse('Cannot change owner role')
    }

    const [updated] = await db
      .update(member)
      .set({ role: body.role })
      .where(eq(member.id, memberId))
      .returning()

    const [userData] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, updated.userId))
      .limit(1)

    const data: AdminMember = {
      id: updated.id,
      userId: updated.userId,
      organizationId: updated.organizationId,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      userName: userData?.name ?? '',
      userEmail: userData?.email ?? '',
    }

    logger.info(`Admin API: Updated member ${memberId} role to ${body.role}`, {
      organizationId,
      previousRole: existingMember.role,
    })

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to update member', { error, organizationId, memberId })
    return internalErrorResponse('Failed to update member')
  }
})

export const DELETE = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId, memberId } = await context.params
  const url = new URL(request.url)
  const skipBillingLogic = !isBillingEnabled || url.searchParams.get('skipBillingLogic') === 'true'

  try {
    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [existingMember] = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (!existingMember) {
      return notFoundResponse('Member')
    }

    const userId = existingMember.userId

    const result = await removeUserFromOrganization({
      userId,
      organizationId,
      memberId,
      skipBillingLogic,
    })

    if (!result.success) {
      if (result.error === 'Cannot remove organization owner') {
        return badRequestResponse(result.error)
      }
      if (result.error === 'Member not found') {
        return notFoundResponse('Member')
      }
      return internalErrorResponse(result.error || 'Failed to remove member')
    }

    logger.info(`Admin API: Removed member ${memberId} from organization ${organizationId}`, {
      userId,
      billingActions: result.billingActions,
    })

    return singleResponse({
      success: true,
      memberId,
      userId,
      billingActions: {
        usageCaptured: result.billingActions.usageCaptured,
        proRestored: result.billingActions.proRestored,
        usageRestored: result.billingActions.usageRestored,
        skipBillingLogic,
      },
    })
  } catch (error) {
    logger.error('Admin API: Failed to remove member', { error, organizationId, memberId })
    return internalErrorResponse('Failed to remove member')
  }
})
