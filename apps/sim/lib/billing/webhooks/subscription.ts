import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { calculateSubscriptionOverage, isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { restoreUserProSubscription } from '@/lib/billing/organizations/membership'
import { isEnterprise, isPaid, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { stripeWebhookIdempotency } from '@/lib/billing/webhooks/idempotency'
import {
  getBilledOverageForSubscription,
  resetUsageForSubscription,
} from '@/lib/billing/webhooks/invoices'
import { captureServerEvent } from '@/lib/posthog/server'
import { detachOrganizationWorkspaces } from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('StripeSubscriptionWebhooks')

/**
 * Restore personal Pro subscriptions for every member of an organization
 * when the team/enterprise subscription ends. Errors propagate so the
 * enclosing webhook handler fails and Stripe retries the delivery.
 *
 * `restoreUserProSubscription` is idempotent: already-restored members
 * are no-ops on retry, so a partial first attempt is safe to re-run.
 */
async function restoreMemberProSubscriptions(organizationId: string): Promise<number> {
  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))

  let restoredCount = 0

  for (const m of members) {
    const result = await restoreUserProSubscription(m.userId)
    if (result.restored) {
      restoredCount++
    }
  }

  if (restoredCount > 0) {
    logger.info('Restored Pro subscriptions for team members', {
      organizationId,
      restoredCount,
      totalMembers: members.length,
    })
  }

  return restoredCount
}

export interface OrganizationDormantTransitionResult {
  restoredProCount: number
  membersSynced: number
  workspacesDetached: number
  organizationRetainsTeamOrEnterprise: boolean
}

/**
 * Returns true when the organization is still covered by an **active
 * Team or Enterprise** subscription other than `excludeSubscriptionId`.
 * The org keeps its team-owned workspaces only while such a sub exists;
 * a Pro sub on the org does not count.
 */
async function hasOtherActiveTeamOrEnterpriseSubscription(
  organizationId: string,
  excludeSubscriptionId: string | null
): Promise<boolean> {
  const filters = [
    eq(subscription.referenceId, organizationId),
    inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
  ]
  if (excludeSubscriptionId) {
    filters.push(ne(subscription.id, excludeSubscriptionId))
  }

  const rows = await db
    .select({ plan: subscription.plan })
    .from(subscription)
    .where(and(...filters))

  return rows.some((row) => isTeam(row.plan) || isEnterprise(row.plan))
}

async function transitionOrganizationToDormantState(
  organizationId: string,
  triggeringSubscriptionId: string | null
): Promise<OrganizationDormantTransitionResult> {
  const memberUserIds = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))

  if (await hasOtherActiveTeamOrEnterpriseSubscription(organizationId, triggeringSubscriptionId)) {
    logger.info(
      'Skipping dormant transition - another Team/Enterprise subscription still covers this organization',
      { organizationId, triggeringSubscriptionId }
    )

    for (const m of memberUserIds) {
      await syncUsageLimitsFromSubscription(m.userId)
    }

    return {
      restoredProCount: 0,
      membersSynced: memberUserIds.length,
      workspacesDetached: 0,
      organizationRetainsTeamOrEnterprise: true,
    }
  }

  const { detachedWorkspaceIds } = await detachOrganizationWorkspaces(organizationId)
  const restoredProCount = await restoreMemberProSubscriptions(organizationId)

  for (const m of memberUserIds) {
    await syncUsageLimitsFromSubscription(m.userId)
  }

  return {
    restoredProCount,
    membersSynced: memberUserIds.length,
    workspacesDetached: detachedWorkspaceIds.length,
    organizationRetainsTeamOrEnterprise: false,
  }
}

export async function handleOrganizationPlanDowngrade(
  subscriptionData: {
    id: string
    plan: string | null
    referenceId: string
    status: string | null
  },
  stripeEventId?: string
): Promise<void> {
  if (!(await isSubscriptionOrgScoped({ referenceId: subscriptionData.referenceId }))) {
    return
  }

  const stillTeamOrEnterprise = isTeam(subscriptionData.plan) || isEnterprise(subscriptionData.plan)
  if (stillTeamOrEnterprise) {
    return
  }

  const [currentRow] = await db
    .select({ plan: subscription.plan })
    .from(subscription)
    .where(eq(subscription.id, subscriptionData.id))
    .limit(1)

  if (currentRow && (isTeam(currentRow.plan) || isEnterprise(currentRow.plan))) {
    logger.info('Skipping plan downgrade transition - subscription is currently Team/Enterprise', {
      subscriptionId: subscriptionData.id,
      organizationId: subscriptionData.referenceId,
      eventPlan: subscriptionData.plan,
      currentPlan: currentRow.plan,
    })
    return
  }

  const idempotencyIdentifier = stripeEventId ?? `plan-downgrade:${subscriptionData.id}`

  try {
    await stripeWebhookIdempotency.executeWithIdempotency(
      'organization-plan-downgrade',
      idempotencyIdentifier,
      async () => {
        const result = await transitionOrganizationToDormantState(
          subscriptionData.referenceId,
          subscriptionData.id
        )

        if (result.workspacesDetached > 0 || result.restoredProCount > 0) {
          logger.info('Transitioned organization to dormant state after plan downgrade', {
            organizationId: subscriptionData.referenceId,
            subscriptionId: subscriptionData.id,
            plan: subscriptionData.plan,
            ...result,
          })
        }

        return result
      }
    )
  } catch (error) {
    logger.error('Failed to transition organization to dormant state on plan downgrade', {
      organizationId: subscriptionData.referenceId,
      subscriptionId: subscriptionData.id,
      plan: subscriptionData.plan,
      error,
    })
    throw error
  }
}

/**
 * Handle new subscription creation - reset usage if transitioning from free to paid
 */
export async function handleSubscriptionCreated(subscriptionData: {
  id: string
  referenceId: string
  plan: string | null
  status: string
}) {
  try {
    const otherActiveSubscriptions = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, subscriptionData.referenceId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
          ne(subscription.id, subscriptionData.id) // Exclude current subscription
        )
      )

    const wasFreePreviously = otherActiveSubscriptions.length === 0
    const isPaidPlan = isPaid(subscriptionData.plan)

    if (wasFreePreviously && isPaidPlan) {
      logger.info('Detected free -> paid transition, resetting usage', {
        subscriptionId: subscriptionData.id,
        referenceId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
      })

      await resetUsageForSubscription({
        plan: subscriptionData.plan,
        referenceId: subscriptionData.referenceId,
      })

      logger.info('Successfully reset usage for free -> paid transition', {
        subscriptionId: subscriptionData.id,
        referenceId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
      })
    } else {
      logger.info('No usage reset needed', {
        subscriptionId: subscriptionData.id,
        referenceId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
        wasFreePreviously,
        isPaidPlan,
        otherActiveSubscriptionsCount: otherActiveSubscriptions.length,
      })
    }

    if (wasFreePreviously && isPaidPlan) {
      captureServerEvent(subscriptionData.referenceId, 'subscription_created', {
        plan: subscriptionData.plan ?? 'unknown',
        status: subscriptionData.status,
        reference_id: subscriptionData.referenceId,
      })
    }
  } catch (error) {
    logger.error('Failed to handle subscription creation usage reset', {
      subscriptionId: subscriptionData.id,
      referenceId: subscriptionData.referenceId,
      error,
    })
    throw error
  }
}

/**
 * Handles a subscription deletion (cancel) event. Bills any final-period
 * overages, resets usage, and transitions the organization to a dormant
 * state via `transitionOrganizationToDormantState` — the same path used
 * by plan downgrades. Wrapped in `stripeWebhookIdempotency` so duplicate
 * event deliveries collapse to one execution; if any step throws, the
 * webhook retries from scratch.
 */
export async function handleSubscriptionDeleted(
  subscription: {
    id: string
    plan: string | null
    referenceId: string
    stripeSubscriptionId: string | null
    seats?: number | null
  },
  stripeEventId?: string
) {
  const stripeSubscriptionId = subscription.stripeSubscriptionId || ''

  logger.info('Processing subscription deletion', {
    stripeEventId,
    stripeSubscriptionId,
    subscriptionId: subscription.id,
  })

  // Fall back to the subscription DB id when we don't have an event id
  // (e.g. called outside the Stripe webhook context). Still dedupes a
  // single subscription's deletion, just not event-granular.
  const idempotencyIdentifier = stripeEventId ?? `sub:${subscription.id}`

  try {
    await stripeWebhookIdempotency.executeWithIdempotency(
      'subscription-deleted',
      idempotencyIdentifier,
      async () => {
        const totalOverage = await calculateSubscriptionOverage(subscription)
        const stripe = requireStripeClient()

        if (isEnterprise(subscription.plan)) {
          await resetUsageForSubscription({
            plan: subscription.plan,
            referenceId: subscription.referenceId,
          })

          const dormantResult = await transitionOrganizationToDormantState(
            subscription.referenceId,
            subscription.id
          )

          logger.info('Successfully processed enterprise subscription cancellation', {
            subscriptionId: subscription.id,
            stripeSubscriptionId,
            ...dormantResult,
          })

          captureServerEvent(subscription.referenceId, 'subscription_cancelled', {
            plan: subscription.plan ?? 'unknown',
            reference_id: subscription.referenceId,
          })

          return { totalOverage: 0, kind: 'enterprise' as const }
        }

        const billedOverage = await getBilledOverageForSubscription(subscription)
        const remainingOverage = Math.max(0, totalOverage - billedOverage)

        logger.info('Subscription deleted overage calculation', {
          subscriptionId: subscription.id,
          totalOverage,
          billedOverage,
          remainingOverage,
        })

        if (remainingOverage > 0 && stripeSubscriptionId) {
          const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
          const customerId = stripeSubscription.customer as string
          const cents = Math.round(remainingOverage * 100)
          const endedAt = stripeSubscription.ended_at || Math.floor(Date.now() / 1000)
          const billingPeriod = new Date(endedAt * 1000).toISOString().slice(0, 7)

          const itemIdemKey = `final-overage-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
          const invoiceIdemKey = `final-overage-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
          const finalizeIdemKey = `final-overage-finalize:${customerId}:${stripeSubscriptionId}:${billingPeriod}`

          const overageInvoice = await stripe.invoices.create(
            {
              customer: customerId,
              collection_method: 'charge_automatically',
              auto_advance: true,
              description: `Final overage charges for ${subscription.plan} subscription (${billingPeriod})`,
              metadata: {
                type: 'final_overage_billing',
                billingPeriod,
                subscriptionId: stripeSubscriptionId,
                cancelledAt: stripeSubscription.canceled_at?.toString() || '',
              },
            },
            { idempotencyKey: invoiceIdemKey }
          )

          await stripe.invoiceItems.create(
            {
              customer: customerId,
              invoice: overageInvoice.id,
              amount: cents,
              currency: 'usd',
              description: `Usage overage for ${subscription.plan} plan (Final billing period)`,
              metadata: {
                type: 'final_usage_overage',
                usage: remainingOverage.toFixed(2),
                totalOverage: totalOverage.toFixed(2),
                billedOverage: billedOverage.toFixed(2),
                billingPeriod,
              },
            },
            { idempotencyKey: itemIdemKey }
          )

          if (overageInvoice.id) {
            await stripe.invoices.finalizeInvoice(
              overageInvoice.id,
              {},
              { idempotencyKey: finalizeIdemKey }
            )
          }

          logger.info('Created final overage invoice for cancelled subscription', {
            subscriptionId: subscription.id,
            stripeSubscriptionId,
            invoiceId: overageInvoice.id,
            totalOverage,
            billedOverage,
            remainingOverage,
            cents,
            billingPeriod,
          })
        } else {
          logger.info('No overage to bill for cancelled subscription', {
            subscriptionId: subscription.id,
            plan: subscription.plan,
          })
        }

        await resetUsageForSubscription({
          plan: subscription.plan,
          referenceId: subscription.referenceId,
        })

        let restoredProCount = 0
        let membersSynced = 0
        let workspacesDetached = 0

        if (await isSubscriptionOrgScoped(subscription)) {
          const dormantResult = await transitionOrganizationToDormantState(
            subscription.referenceId,
            subscription.id
          )
          restoredProCount = dormantResult.restoredProCount
          membersSynced = dormantResult.membersSynced
          workspacesDetached = dormantResult.workspacesDetached
        } else if (isPro(subscription.plan)) {
          await syncUsageLimitsFromSubscription(subscription.referenceId)
          membersSynced = 1
        }

        logger.info('Successfully processed subscription cancellation', {
          subscriptionId: subscription.id,
          stripeSubscriptionId,
          plan: subscription.plan,
          totalOverage,
          restoredProCount,
          membersSynced,
          workspacesDetached,
        })

        captureServerEvent(subscription.referenceId, 'subscription_cancelled', {
          plan: subscription.plan ?? 'unknown',
          reference_id: subscription.referenceId,
        })

        return { totalOverage, remainingOverage, restoredProCount, workspacesDetached }
      }
    )
  } catch (error) {
    logger.error('Failed to handle subscription deletion', {
      subscriptionId: subscription.id,
      stripeSubscriptionId,
      error,
    })
    throw error
  }
}
