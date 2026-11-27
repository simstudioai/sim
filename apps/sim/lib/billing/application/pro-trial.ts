import Stripe from 'stripe'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { isTrialingSubscription } from '@/lib/billing/subscriptions/utils'
import { assertOperationCapability, type OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { UserAccountOperation } from '@/lib/users/application/operations'
import { authorizeAccountPreferences } from '@/lib/users/application/preferences-authorization'

/** Session-only: ending a trial charges the account's own card, so no delegation may do it. */
function defineProTrialOperation<const Id extends string>(id: Id) {
  const operation = {
    id,
    capability: 'none',
    principalKinds: Object.freeze(['session'] as const),
  } satisfies UserAccountOperation
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

export const proTrialOperations = {
  // permission-group-exempt: ending your own personal trial is an account act, not a workspace act.
  end: defineProTrialOperation('billing.trial.end'),
} as const

/**
 * Ends the caller's own Pro free trial now. Stripe charges the card for the first paid period,
 * and the subscription webhooks replace the trial allowance with the plan's. Only the account's
 * own trialing personal subscription qualifies; nobody else's trial can be ended this way.
 */
export const endProTrial: OperationUseCase<
  typeof proTrialOperations.end,
  Record<string, never>,
  { success: true }
> = {
  operation: proTrialOperations.end,
  async execute({ principal }) {
    const userId = await authorizeAccountPreferences(principal, proTrialOperations.end)
    const subscription = await getHighestPriorityPersonalSubscription(userId, { onError: 'throw' })
    if (
      !subscription ||
      subscription.referenceId !== userId ||
      !isTrialingSubscription(subscription) ||
      !subscription.stripeSubscriptionId ||
      subscription.cancelAtPeriodEnd
    ) {
      throw new OrchestrationError('conflict', 'There is no free trial to end on this account')
    }
    try {
      // A failed first charge leaves the trial running instead of starting a past-due plan. The
      // key absorbs a double click but not a retry a minute later, since Stripe replays a stored
      // decline for a day and the payer may have just fixed their card.
      await requireStripeClient().subscriptions.update(
        subscription.stripeSubscriptionId,
        { trial_end: 'now', payment_behavior: 'error_if_incomplete' },
        {
          idempotencyKey: `end-trial-early:${subscription.stripeSubscriptionId}:${Math.floor(Date.now() / 60_000)}`,
        }
      )
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        throw new OrchestrationError(
          'conflict',
          'Your card could not be charged. Update your payment method, then try again.'
        )
      }
      throw error
    }
    return { success: true }
  },
}
