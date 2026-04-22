import { db } from '@sim/db'
import { invitation, member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { isTeam } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import {
  hasUsableSubscriptionStatus,
  USABLE_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { syncSeatsFromStripeQuantity } from '@/lib/billing/validation/seat-management'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationSeatsAPI')

const updateSeatsSchema = z.object({
  seats: z.number().int().min(1, 'Minimum 1 seat required').max(50, 'Maximum 50 seats allowed'),
})

/**
 * PUT /api/organizations/[id]/seats
 * Update organization seat count using Stripe's subscription.update API.
 * This is the recommended approach for per-seat billing changes.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (!isBillingEnabled) {
        return NextResponse.json({ error: 'Billing is not enabled' }, { status: 400 })
      }

      const { id: organizationId } = await params
      const body = await request.json()

      const validation = updateSeatsSchema.safeParse(body)
      if (!validation.success) {
        const firstError = validation.error.errors[0]
        return NextResponse.json({ error: firstError.message }, { status: 400 })
      }

      const { seats: newSeatCount } = validation.data

      // Verify user has admin access to this organization
      const memberEntry = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (memberEntry.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      if (!['owner', 'admin'].includes(memberEntry[0].role)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      // Get the organization's subscription
      const subscriptionRecord = await db
        .select()
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, organizationId),
            inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
          )
        )
        .limit(1)

      if (subscriptionRecord.length === 0) {
        return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
      }

      const orgSubscription = subscriptionRecord[0]

      if (await isOrganizationBillingBlocked(organizationId)) {
        return NextResponse.json({ error: 'An active subscription is required' }, { status: 400 })
      }

      // Only team plans support seat changes (not enterprise - those are handled manually)
      if (!isTeam(orgSubscription.plan)) {
        return NextResponse.json(
          { error: 'Seat changes are only available for Team plans' },
          { status: 400 }
        )
      }

      if (!orgSubscription.stripeSubscriptionId) {
        return NextResponse.json(
          { error: 'No Stripe subscription found for this organization' },
          { status: 400 }
        )
      }

      const [memberCountRow] = await db
        .select({ count: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      const [pendingCountRow] = await db
        .select({ count: count() })
        .from(invitation)
        .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))

      const memberCount = memberCountRow?.count ?? 0
      const pendingCount = pendingCountRow?.count ?? 0
      const occupiedSeats = memberCount + pendingCount

      if (newSeatCount < occupiedSeats) {
        return NextResponse.json(
          {
            error: `Cannot reduce seats below current occupancy (${memberCount} member${memberCount === 1 ? '' : 's'} + ${pendingCount} pending invite${pendingCount === 1 ? '' : 's'}). Cancel pending invites first or remove members.`,
            currentMembers: memberCount,
            pendingInvitations: pendingCount,
            occupiedSeats,
          },
          { status: 400 }
        )
      }

      const currentSeats = orgSubscription.seats || 1

      // If no change, return early
      if (newSeatCount === currentSeats) {
        return NextResponse.json({
          success: true,
          message: 'No change in seat count',
          data: {
            seats: currentSeats,
            stripeSubscriptionId: orgSubscription.stripeSubscriptionId,
          },
        })
      }

      const stripe = requireStripeClient()

      // Get the Stripe subscription to find the subscription item ID
      const stripeSubscription = await stripe.subscriptions.retrieve(
        orgSubscription.stripeSubscriptionId
      )

      if (!hasUsableSubscriptionStatus(stripeSubscription.status)) {
        return NextResponse.json({ error: 'Stripe subscription is not active' }, { status: 400 })
      }

      // Find the subscription item (there should be only one for team plans)
      const subscriptionItem = stripeSubscription.items.data[0]

      if (!subscriptionItem) {
        return NextResponse.json(
          { error: 'No subscription item found in Stripe subscription' },
          { status: 500 }
        )
      }

      logger.info('Updating Stripe subscription quantity', {
        organizationId,
        stripeSubscriptionId: orgSubscription.stripeSubscriptionId,
        subscriptionItemId: subscriptionItem.id,
        currentSeats,
        newSeatCount,
        userId: session.user.id,
      })

      const updatedSubscription = await stripe.subscriptions.update(
        orgSubscription.stripeSubscriptionId,
        {
          items: [
            {
              id: subscriptionItem.id,
              quantity: newSeatCount,
            },
          ],
          proration_behavior: 'always_invoice',
        },
        { idempotencyKey: `seats-update:${orgSubscription.stripeSubscriptionId}:${newSeatCount}` }
      )

      await syncSeatsFromStripeQuantity(
        orgSubscription.id,
        orgSubscription.seats,
        updatedSubscription.items.data[0]?.quantity ?? newSeatCount
      )

      const { basePrice } = getPlanPricing(orgSubscription.plan)
      const newMinimumLimit = newSeatCount * basePrice

      const orgData = await db
        .select({ orgUsageLimit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      const currentOrgLimit =
        orgData.length > 0 && orgData[0].orgUsageLimit
          ? toNumber(toDecimal(orgData[0].orgUsageLimit))
          : 0

      // Update if new minimum is higher than current limit
      if (newMinimumLimit > currentOrgLimit) {
        await db
          .update(organization)
          .set({
            orgUsageLimit: newMinimumLimit.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(organization.id, organizationId))

        logger.info('Updated organization usage limit for seat change', {
          organizationId,
          newSeatCount,
          newMinimumLimit,
          previousLimit: currentOrgLimit,
        })
      }

      logger.info('Successfully updated seat count', {
        organizationId,
        stripeSubscriptionId: orgSubscription.stripeSubscriptionId,
        oldSeats: currentSeats,
        newSeats: newSeatCount,
        updatedBy: session.user.id,
        prorationBehavior: 'always_invoice',
      })

      return NextResponse.json({
        success: true,
        message:
          newSeatCount > currentSeats
            ? `Added ${newSeatCount - currentSeats} seat(s). Your billing has been adjusted.`
            : `Removed ${currentSeats - newSeatCount} seat(s). You'll receive a prorated credit.`,
        data: {
          seats: newSeatCount,
          previousSeats: currentSeats,
          stripeSubscriptionId: updatedSubscription.id,
          stripeStatus: updatedSubscription.status,
        },
      })
    } catch (error) {
      const { id: organizationId } = await params

      // Handle Stripe-specific errors
      if (error instanceof Error && 'type' in error) {
        const stripeError = error as any
        logger.error('Stripe error updating seats', {
          organizationId,
          type: stripeError.type,
          code: stripeError.code,
          message: stripeError.message,
        })

        return NextResponse.json(
          {
            error: stripeError.message || 'Failed to update seats in Stripe',
            code: stripeError.code,
          },
          { status: 400 }
        )
      }

      logger.error('Failed to update organization seats', {
        organizationId,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
