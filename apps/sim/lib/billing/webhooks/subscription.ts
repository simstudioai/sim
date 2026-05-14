import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  attributeLegacyOrganizationUsageForPeriod,
  createOverageBillingClaim,
} from '@/lib/billing/ledger/usage-ledger'
import { restoreUserProSubscription } from '@/lib/billing/organizations/membership'
import {
  doesOrganizationSubscriptionOwnMemberUsage,
  isEnterprise,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { stripeWebhookIdempotency } from '@/lib/billing/webhooks/idempotency'
import { resetUsageForSubscription } from '@/lib/billing/webhooks/invoices'
import { captureServerEvent } from '@/lib/posthog/server'
import { detachOrganizationWorkspaces } from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('StripeSubscriptionWebhooks')

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
    .select({ userId: member.userId, role: member.role })
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
  const activeOrgSubs = await db
    .select({ id: subscription.id, plan: subscription.plan })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, organizationId),
        inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
      )
    )
  const activeCoveringOrgSubs = activeOrgSubs.filter((sub) => sub.id !== triggeringSubscriptionId)

  let restoredProCount = 0
  for (const m of memberUserIds) {
    const stillOwnedByOrg = activeCoveringOrgSubs.some((sub) =>
      doesOrganizationSubscriptionOwnMemberUsage(sub.plan, m.role)
    )
    if (stillOwnedByOrg) continue

    const result = await restoreUserProSubscription(m.userId)
    if (result.restored) {
      restoredProCount++
    }
  }

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
    previousPlan?: string | null
    plan: string | null
    referenceId: string
    status: string | null
    periodStart?: Date | null
    periodEnd?: Date | null
    usageCutoff?: Date | null
    seats?: number | null
    stripeCustomerId?: string | null
    stripeSubscriptionId?: string | null
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
        if (
          (isTeam(subscriptionData.previousPlan) || isEnterprise(subscriptionData.previousPlan)) &&
          !(isTeam(subscriptionData.plan) || isEnterprise(subscriptionData.plan))
        ) {
          if (!subscriptionData.periodStart || !subscriptionData.periodEnd) {
            throw new Error('Subscription period is required for organization downgrade billing')
          }
          if (!subscriptionData.usageCutoff) {
            throw new Error('Usage cutoff is required for organization downgrade billing')
          }

          const periodStart = subscriptionData.periodStart
          const periodEnd = subscriptionData.periodEnd
          const usageCutoff = subscriptionData.usageCutoff
          const attributedRows = await attributeLegacyOrganizationUsageForPeriod({
            organizationId: subscriptionData.referenceId,
            periodStart,
            periodEnd,
            usageCutoff,
          })
          if (attributedRows > 0) {
            logger.info('Attributed pooled legacy usage before organization plan downgrade', {
              organizationId: subscriptionData.referenceId,
              subscriptionId: subscriptionData.id,
              previousPlan: subscriptionData.previousPlan,
              newPlan: subscriptionData.plan,
              attributedRows,
            })
          }

          if (isTeam(subscriptionData.previousPlan)) {
            let customerId = subscriptionData.stripeCustomerId ?? null
            if (!customerId && subscriptionData.stripeSubscriptionId) {
              const stripe = requireStripeClient()
              const stripeSubscription = await stripe.subscriptions.retrieve(
                subscriptionData.stripeSubscriptionId
              )
              customerId =
                typeof stripeSubscription.customer === 'string'
                  ? stripeSubscription.customer
                  : stripeSubscription.customer.id
            }

            if (!subscriptionData.stripeSubscriptionId || !customerId) {
              throw new Error(
                'Stripe customer and subscription ids are required for downgrade claim'
              )
            }

            const billingPeriod = periodEnd.toISOString().slice(0, 7)
            const claim = await createOverageBillingClaim({
              subscription: {
                id: subscriptionData.id,
                plan: subscriptionData.previousPlan ?? null,
                referenceId: subscriptionData.referenceId,
                seats: subscriptionData.seats ?? null,
                periodStart,
                periodEnd,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionData.stripeSubscriptionId,
              },
              claimType: 'final',
              periodStart,
              periodEnd,
              usageCutoff,
              customerId,
              stripeSubscriptionId: subscriptionData.stripeSubscriptionId,
              description: `Final overage charges before downgrade from ${subscriptionData.previousPlan} (${billingPeriod})`,
              itemDescription: `Usage overage before downgrade from ${subscriptionData.previousPlan}`,
              enqueueStripeInvoice: true,
              metadata: {
                billingPeriod,
                subscriptionId: subscriptionData.stripeSubscriptionId,
                downgradeEventId: idempotencyIdentifier,
                previousPlan: subscriptionData.previousPlan ?? '',
                newPlan: subscriptionData.plan ?? '',
                usageCutoff: usageCutoff.toISOString(),
              },
            })

            logger.info('Created final pooled overage claim before organization plan downgrade', {
              organizationId: subscriptionData.referenceId,
              subscriptionId: subscriptionData.id,
              claimId: claim.claimId,
              claimed: claim.claimed,
              overageAmount: claim.overageAmount,
              priorCoveredOverage: claim.priorCoveredOverage,
              creditApplied: claim.creditApplied,
              amountToBill: claim.amountToBill,
            })
          }
        }

        const result = await transitionOrganizationToDormantState(
          subscriptionData.referenceId,
          null
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
    stripeCustomerId?: string | null
    seats?: number | null
    periodStart?: Date | null
    periodEnd?: Date | null
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
        const orgScoped = await isSubscriptionOrgScoped(subscription)
        if (orgScoped && isEnterprise(subscription.plan)) {
          if (subscription.periodStart && subscription.periodEnd) {
            const attributedRows = await attributeLegacyOrganizationUsageForPeriod({
              organizationId: subscription.referenceId,
              periodStart: subscription.periodStart,
              periodEnd: subscription.periodEnd,
              usageCutoff: subscription.periodEnd,
            })
            if (attributedRows > 0) {
              logger.info(
                'Attributed legacy usage rows before organization subscription cancellation',
                {
                  subscriptionId: subscription.id,
                  organizationId: subscription.referenceId,
                  attributedRows,
                }
              )
            }
          } else {
            logger.warn('Skipping enterprise cancellation attribution without a billing period', {
              subscriptionId: subscription.id,
              organizationId: subscription.referenceId,
            })
          }
        }

        if (isEnterprise(subscription.plan)) {
          const dormantResult = await transitionOrganizationToDormantState(
            subscription.referenceId,
            subscription.id
          )

          await resetUsageForSubscription({
            plan: subscription.plan,
            referenceId: subscription.referenceId,
          })

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

        const stripe = requireStripeClient()
        let totalOverage = 0

        if (stripeSubscriptionId) {
          const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
          const customerId =
            typeof stripeSubscription.customer === 'string'
              ? stripeSubscription.customer
              : stripeSubscription.customer.id
          if (!stripeSubscription.ended_at) {
            throw new Error('Stripe subscription ended_at is required for cancellation billing')
          }
          if (!subscription.periodStart || !subscription.periodEnd) {
            throw new Error('Subscription period is required for cancellation billing')
          }
          const endedAt = stripeSubscription.ended_at
          const periodStart = subscription.periodStart
          const usageCutoff = new Date(endedAt * 1000)
          const periodEnd = subscription.periodEnd
          const billingPeriod = periodEnd.toISOString().slice(0, 7)

          if (orgScoped && isTeam(subscription.plan)) {
            const attributedRows = await attributeLegacyOrganizationUsageForPeriod({
              organizationId: subscription.referenceId,
              periodStart,
              periodEnd,
              usageCutoff,
            })
            if (attributedRows > 0) {
              logger.info('Attributed legacy usage rows before organization final claim', {
                subscriptionId: subscription.id,
                organizationId: subscription.referenceId,
                attributedRows,
              })
            }
          }

          const claim = await createOverageBillingClaim({
            subscription: {
              ...subscription,
              periodStart,
              periodEnd,
            },
            claimType: 'final',
            periodStart,
            periodEnd,
            usageCutoff,
            customerId: subscription.stripeCustomerId ?? customerId,
            stripeSubscriptionId,
            description: `Final overage charges for ${subscription.plan} subscription (${billingPeriod})`,
            itemDescription: `Usage overage for ${subscription.plan} plan (Final billing period)`,
            enqueueStripeInvoice: true,
            metadata: {
              billingPeriod,
              subscriptionId: stripeSubscriptionId,
              cancelledAt: stripeSubscription.canceled_at?.toString() || '',
              usageCutoff: usageCutoff.toISOString(),
            },
          })
          totalOverage = claim.priorCoveredOverage + claim.overageAmount

          logger.info('Created final overage ledger claim for cancelled subscription', {
            subscriptionId: subscription.id,
            stripeSubscriptionId,
            totalOverage,
            claimId: claim.claimId,
            claimed: claim.claimed,
            overageAmount: claim.overageAmount,
            priorCoveredOverage: claim.priorCoveredOverage,
            creditApplied: claim.creditApplied,
            amountToBill: claim.amountToBill,
            billingPeriod,
          })
        } else {
          logger.info('No overage to bill for cancelled subscription', {
            subscriptionId: subscription.id,
            plan: subscription.plan,
          })
        }

        let restoredProCount = 0
        let membersSynced = 0
        let workspacesDetached = 0

        if (orgScoped) {
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

        await resetUsageForSubscription({
          plan: subscription.plan,
          referenceId: subscription.referenceId,
        })

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

        return { totalOverage, restoredProCount, workspacesDetached }
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
