/**
 * GET /api/v1/admin/organizations/[id]/seats
 *
 * Get organization seat analytics including member activity.
 *
 * Response: AdminSingleResponse<AdminSeatAnalytics>
 *
 * PATCH /api/v1/admin/organizations/[id]/seats
 *
 * Update organization seat count with Stripe sync (matches user flow).
 *
 * Body:
 *   - seats: number - New seat count (positive integer)
 *
 * Response: AdminSingleResponse<{ success: true, seats: number, plan: string, stripeUpdated?: boolean }>
 */

import { db } from '@sim/db'
import { organization, subscription } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getOrganizationSeatAnalytics } from '@/lib/billing/validation/seat-management'
import { createLogger } from '@/lib/logs/console/logger'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminSeatAnalytics } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationSeatsAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: organizationId } = await context.params

  try {
    const analytics = await getOrganizationSeatAnalytics(organizationId)

    if (!analytics) {
      return notFoundResponse('Organization or subscription')
    }

    const data: AdminSeatAnalytics = {
      organizationId: analytics.organizationId,
      organizationName: analytics.organizationName,
      currentSeats: analytics.currentSeats,
      maxSeats: analytics.maxSeats,
      availableSeats: analytics.availableSeats,
      subscriptionPlan: analytics.subscriptionPlan,
      canAddSeats: analytics.canAddSeats,
      utilizationRate: analytics.utilizationRate,
      activeMembers: analytics.activeMembers,
      inactiveMembers: analytics.inactiveMembers,
      memberActivity: analytics.memberActivity.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        userEmail: m.userEmail,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        lastActive: m.lastActive?.toISOString() ?? null,
      })),
    }

    logger.info(`Admin API: Retrieved seat analytics for organization ${organizationId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get organization seats', { error, organizationId })
    return internalErrorResponse('Failed to get organization seats')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const body = await request.json()

    if (typeof body.seats !== 'number' || body.seats < 1 || !Number.isInteger(body.seats)) {
      return badRequestResponse('seats must be a positive integer')
    }

    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [subData] = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
      .limit(1)

    if (!subData) {
      return notFoundResponse('Subscription')
    }

    const newSeatCount = body.seats
    let stripeUpdated = false

    if (subData.plan === 'enterprise') {
      const currentMetadata = (subData.metadata as Record<string, unknown>) || {}
      const newMetadata = {
        ...currentMetadata,
        seats: newSeatCount,
      }

      await db
        .update(subscription)
        .set({ metadata: newMetadata })
        .where(eq(subscription.id, subData.id))

      logger.info(`Admin API: Updated enterprise seats for organization ${organizationId}`, {
        seats: newSeatCount,
      })
    } else if (subData.plan === 'team') {
      if (subData.stripeSubscriptionId) {
        const stripe = requireStripeClient()

        const stripeSubscription = await stripe.subscriptions.retrieve(subData.stripeSubscriptionId)

        if (stripeSubscription.status !== 'active') {
          return badRequestResponse('Stripe subscription is not active')
        }

        const subscriptionItem = stripeSubscription.items.data[0]
        if (!subscriptionItem) {
          return internalErrorResponse('No subscription item found in Stripe subscription')
        }

        const currentSeats = subData.seats || 1

        logger.info('Admin API: Updating Stripe subscription quantity', {
          organizationId,
          stripeSubscriptionId: subData.stripeSubscriptionId,
          subscriptionItemId: subscriptionItem.id,
          currentSeats,
          newSeatCount,
        })

        await stripe.subscriptions.update(subData.stripeSubscriptionId, {
          items: [
            {
              id: subscriptionItem.id,
              quantity: newSeatCount,
            },
          ],
          proration_behavior: 'create_prorations',
        })

        stripeUpdated = true
      }

      await db
        .update(subscription)
        .set({ seats: newSeatCount })
        .where(eq(subscription.id, subData.id))

      logger.info(`Admin API: Updated team seats for organization ${organizationId}`, {
        seats: newSeatCount,
        stripeUpdated,
      })
    } else {
      await db
        .update(subscription)
        .set({ seats: newSeatCount })
        .where(eq(subscription.id, subData.id))

      logger.info(`Admin API: Updated seats for organization ${organizationId}`, {
        seats: newSeatCount,
        plan: subData.plan,
      })
    }

    return singleResponse({
      success: true,
      seats: newSeatCount,
      plan: subData.plan,
      stripeUpdated,
    })
  } catch (error) {
    logger.error('Admin API: Failed to update organization seats', { error, organizationId })
    return internalErrorResponse('Failed to update organization seats')
  }
})
