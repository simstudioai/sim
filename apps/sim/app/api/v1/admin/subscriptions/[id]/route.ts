/**
 * GET /api/v1/admin/subscriptions/[id]
 *
 * Get subscription details.
 *
 * Response: AdminSingleResponse<AdminSubscription>
 *
 * DELETE /api/v1/admin/subscriptions/[id]
 *
 * Cancel a subscription by triggering Stripe cancellation.
 * The Stripe webhook handles all cleanup (same as platform cancellation):
 *   - Updates subscription status to canceled
 *   - Bills final period overages
 *   - Resets usage
 *   - Restores member Pro subscriptions (for team/enterprise)
 *   - Deletes organization (for team/enterprise)
 *   - Syncs usage limits to free tier
 *
 * Query Parameters:
 *   - atPeriodEnd?: boolean - Schedule cancellation at period end instead of immediate (default: false)
 *   - reason?: string - Reason for cancellation (for audit logging)
 *
 * Response: { success: true, message: string, subscriptionId: string, atPeriodEnd: boolean }
 */

import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminSubscription } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminSubscriptionDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: subscriptionId } = await context.params

  try {
    const [subData] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1)

    if (!subData) {
      return notFoundResponse('Subscription')
    }

    logger.info(`Admin API: Retrieved subscription ${subscriptionId}`)

    return singleResponse(toAdminSubscription(subData))
  } catch (error) {
    logger.error('Admin API: Failed to get subscription', { error, subscriptionId })
    return internalErrorResponse('Failed to get subscription')
  }
})

export const DELETE = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: subscriptionId } = await context.params
  const url = new URL(request.url)
  const atPeriodEnd = url.searchParams.get('atPeriodEnd') === 'true'
  const reason = url.searchParams.get('reason') || 'Admin cancellation (no reason provided)'

  try {
    const [existing] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1)

    if (!existing) {
      return notFoundResponse('Subscription')
    }

    if (existing.status === 'canceled') {
      return badRequestResponse('Subscription is already canceled')
    }

    if (!existing.stripeSubscriptionId) {
      return badRequestResponse('Subscription has no Stripe subscription ID')
    }

    const stripe = requireStripeClient()

    if (atPeriodEnd) {
      // Schedule cancellation at period end
      await stripe.subscriptions.update(existing.stripeSubscriptionId, {
        cancel_at_period_end: true,
      })

      // Update DB (webhooks don't sync cancelAtPeriodEnd)
      await db
        .update(subscription)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscription.id, subscriptionId))

      logger.info('Admin API: Scheduled subscription cancellation at period end', {
        subscriptionId,
        stripeSubscriptionId: existing.stripeSubscriptionId,
        plan: existing.plan,
        referenceId: existing.referenceId,
        periodEnd: existing.periodEnd,
        reason,
      })

      return singleResponse({
        success: true,
        message: 'Subscription scheduled to cancel at period end.',
        subscriptionId,
        stripeSubscriptionId: existing.stripeSubscriptionId,
        atPeriodEnd: true,
        periodEnd: existing.periodEnd?.toISOString() ?? null,
      })
    }

    // Immediate cancellation
    await stripe.subscriptions.cancel(existing.stripeSubscriptionId, {
      prorate: true,
      invoice_now: true,
    })

    logger.info('Admin API: Triggered immediate subscription cancellation on Stripe', {
      subscriptionId,
      stripeSubscriptionId: existing.stripeSubscriptionId,
      plan: existing.plan,
      referenceId: existing.referenceId,
      reason,
    })

    return singleResponse({
      success: true,
      message: 'Subscription cancellation triggered. Webhook will complete cleanup.',
      subscriptionId,
      stripeSubscriptionId: existing.stripeSubscriptionId,
      atPeriodEnd: false,
    })
  } catch (error) {
    logger.error('Admin API: Failed to cancel subscription', { error, subscriptionId })
    return internalErrorResponse('Failed to cancel subscription')
  }
})
