/**
 * GET /api/v1/admin/organizations/[id]/billing
 *
 * Get organization billing summary including usage, seats, and member data.
 *
 * Response: AdminSingleResponse<AdminOrganizationBillingSummary>
 *
 * PATCH /api/v1/admin/organizations/[id]/billing
 *
 * Update organization billing settings.
 *
 * Body:
 *   - orgUsageLimit?: number - New usage limit (null to clear)
 *
 * Response: AdminSingleResponse<{ success: true, orgUsageLimit: string | null }>
 */

import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import { getOrganizationBillingData } from '@/lib/billing/core/organization'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminOrganizationBillingSummary } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationBillingAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: organizationId } = await context.params

  try {
    if (!isBillingEnabled) {
      const [[orgData], [memberCount]] = await Promise.all([
        db.select().from(organization).where(eq(organization.id, organizationId)).limit(1),
        db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
      ])

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const data: AdminOrganizationBillingSummary = {
        organizationId: orgData.id,
        organizationName: orgData.name,
        subscriptionPlan: 'none',
        subscriptionStatus: 'none',
        totalSeats: Number.MAX_SAFE_INTEGER,
        usedSeats: memberCount?.count || 0,
        availableSeats: Number.MAX_SAFE_INTEGER,
        totalCurrentUsage: 0,
        totalUsageLimit: Number.MAX_SAFE_INTEGER,
        minimumBillingAmount: 0,
        averageUsagePerMember: 0,
        usagePercentage: 0,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        membersOverLimit: 0,
        membersNearLimit: 0,
      }

      logger.info(
        `Admin API: Retrieved billing summary for organization ${organizationId} (billing disabled)`
      )

      return singleResponse(data)
    }

    const billingData = await getOrganizationBillingData(organizationId)

    if (!billingData) {
      return notFoundResponse('Organization or subscription')
    }

    const membersOverLimit = billingData.members.filter((m) => m.isOverLimit).length
    const membersNearLimit = billingData.members.filter(
      (m) => !m.isOverLimit && m.percentUsed >= 80
    ).length
    const usagePercentage =
      billingData.totalUsageLimit > 0
        ? Math.round((billingData.totalCurrentUsage / billingData.totalUsageLimit) * 10000) / 100
        : 0

    const data: AdminOrganizationBillingSummary = {
      organizationId: billingData.organizationId,
      organizationName: billingData.organizationName,
      subscriptionPlan: billingData.subscriptionPlan,
      subscriptionStatus: billingData.subscriptionStatus,
      totalSeats: billingData.totalSeats,
      usedSeats: billingData.usedSeats,
      availableSeats: billingData.totalSeats - billingData.usedSeats,
      totalCurrentUsage: billingData.totalCurrentUsage,
      totalUsageLimit: billingData.totalUsageLimit,
      minimumBillingAmount: billingData.minimumBillingAmount,
      averageUsagePerMember: billingData.averageUsagePerMember,
      usagePercentage,
      billingPeriodStart: billingData.billingPeriodStart?.toISOString() ?? null,
      billingPeriodEnd: billingData.billingPeriodEnd?.toISOString() ?? null,
      membersOverLimit,
      membersNearLimit,
    }

    logger.info(`Admin API: Retrieved billing summary for organization ${organizationId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get organization billing', { error, organizationId })
    return internalErrorResponse('Failed to get organization billing')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const body = await request.json()

    const [orgData] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    if (body.orgUsageLimit !== undefined) {
      let newLimit: string | null = null

      if (body.orgUsageLimit === null) {
        newLimit = null
      } else if (typeof body.orgUsageLimit === 'number' && body.orgUsageLimit >= 0) {
        newLimit = body.orgUsageLimit.toFixed(2)
      } else {
        return badRequestResponse('orgUsageLimit must be a non-negative number or null')
      }

      await db
        .update(organization)
        .set({
          orgUsageLimit: newLimit,
          updatedAt: new Date(),
        })
        .where(eq(organization.id, organizationId))

      logger.info(`Admin API: Updated usage limit for organization ${organizationId}`, {
        newLimit,
      })

      return singleResponse({
        success: true,
        orgUsageLimit: newLimit,
      })
    }

    return badRequestResponse('No valid fields to update')
  } catch (error) {
    logger.error('Admin API: Failed to update organization billing', { error, organizationId })
    return internalErrorResponse('Failed to update organization billing')
  }
})
