/**
 * POST /api/v1/admin/users/[id]/billing/move-to-org
 *
 * Move a user to an organization with full billing logic.
 * Enforces single-org constraint, handles Pro snapshot/cancellation.
 *
 * Body:
 *   - organizationId: string - Target organization ID
 *   - role?: string - Role in organization ('admin' | 'member'), defaults to 'member'
 *   - skipBillingLogic?: boolean - Skip Pro handling (default: false)
 *
 * Response: AdminSingleResponse<{
 *   success: true,
 *   memberId: string,
 *   organizationId: string,
 *   role: string,
 *   action: 'created' | 'updated' | 'already_member',
 *   billingActions: { proUsageSnapshotted, proCancelledAtPeriodEnd }
 * }>
 */

import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { addUserToOrganization } from '@/lib/billing/organizations/membership'
import { createLogger } from '@/lib/logs/console/logger'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminUserMoveToOrgAPI')

interface RouteParams {
  id: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: userId } = await context.params

  try {
    const body = await request.json()

    if (!body.organizationId || typeof body.organizationId !== 'string') {
      return badRequestResponse('organizationId is required')
    }

    const role = body.role || 'member'
    if (!['admin', 'member'].includes(role)) {
      return badRequestResponse('role must be "admin" or "member"')
    }

    const skipBillingLogic = body.skipBillingLogic === true

    const [userData] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    const [orgData] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, body.organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const existingMemberships = await db
      .select({ id: member.id, organizationId: member.organizationId, role: member.role })
      .from(member)
      .where(eq(member.userId, userId))

    const existingInThisOrg = existingMemberships.find(
      (m) => m.organizationId === body.organizationId
    )
    if (existingInThisOrg) {
      if (existingInThisOrg.role !== role) {
        await db.update(member).set({ role }).where(eq(member.id, existingInThisOrg.id))

        logger.info(
          `Admin API: Updated user ${userId} role in organization ${body.organizationId}`,
          {
            previousRole: existingInThisOrg.role,
            newRole: role,
          }
        )

        return singleResponse({
          success: true,
          memberId: existingInThisOrg.id,
          organizationId: body.organizationId,
          organizationName: orgData.name,
          role,
          action: 'updated',
          billingActions: {
            proUsageSnapshotted: false,
            proCancelledAtPeriodEnd: false,
          },
        })
      }

      return singleResponse({
        success: true,
        memberId: existingInThisOrg.id,
        organizationId: body.organizationId,
        organizationName: orgData.name,
        role: existingInThisOrg.role,
        action: 'already_member',
        billingActions: {
          proUsageSnapshotted: false,
          proCancelledAtPeriodEnd: false,
        },
      })
    }

    const result = await addUserToOrganization({
      userId,
      organizationId: body.organizationId,
      role,
      skipBillingLogic,
    })

    if (!result.success) {
      return badRequestResponse(result.error || 'Failed to move user to organization')
    }

    logger.info(`Admin API: Moved user ${userId} to organization ${body.organizationId}`, {
      role,
      memberId: result.memberId,
      billingActions: result.billingActions,
      skipBillingLogic,
    })

    return singleResponse({
      success: true,
      memberId: result.memberId,
      organizationId: body.organizationId,
      organizationName: orgData.name,
      role,
      action: 'created',
      billingActions: {
        proUsageSnapshotted: result.billingActions.proUsageSnapshotted,
        proCancelledAtPeriodEnd: result.billingActions.proCancelledAtPeriodEnd,
      },
    })
  } catch (error) {
    logger.error('Admin API: Failed to move user to organization', { error, userId })
    return internalErrorResponse('Failed to move user to organization')
  }
})
