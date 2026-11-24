import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getCustomerId, getPaymentMethodId } from '@/lib/billing/stripe-payment-method'
import {
  hasPaidSubscriptionStatus,
  isEnterpriseSelfServe,
  isSelfServeEnterpriseMetadata,
} from '@/lib/billing/subscriptions/utils'
import { withEnterpriseReconciliationLease } from '@/lib/billing/webhooks/enterprise-reconciliation-lease'

const logger = createLogger('EnterpriseAutoPay')

/** Marks the setup Checkout session a self-serve Enterprise customer opens to turn on auto-pay. */
export const ENTERPRISE_AUTO_PAY_PURPOSE = 'enterprise_auto_pay'

/**
 * Switches an Enterprise contract to automatic payment once its customer saves a payment method
 * on Stripe's setup page: the method becomes the default for the subscription and for the
 * customer's ad-hoc invoices (true-ups, overage), and renewals stop being emailed for payment.
 * Changing the collection method only affects invoices created afterwards. Ignores every other
 * Checkout session.
 */
export async function handleEnterpriseAutoPaySetup(session: Stripe.Checkout.Session) {
  if (session.mode !== 'setup' || session.metadata?.purpose !== ENTERPRISE_AUTO_PAY_PURPOSE) return

  const { organizationId, stripeSubscriptionId } = session.metadata
  const setupIntentId =
    typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id
  if (!organizationId || !stripeSubscriptionId || !setupIntentId) {
    logger.error('Enterprise auto-pay session is missing its references', {
      sessionId: session.id,
    })
    return
  }

  // A session lives a day: the contract may have left self-serve or ended since it was opened.
  // A past-due contract still qualifies, since a new payment method is how it recovers.
  const [contract] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)
  if (
    !contract?.stripeCustomerId ||
    contract.referenceId !== organizationId ||
    contract.stripeCustomerId !== getCustomerId(session.customer) ||
    !isEnterpriseSelfServe(contract) ||
    !hasPaidSubscriptionStatus(contract.status)
  ) {
    logger.warn('Enterprise auto-pay session no longer matches a self-serve contract', {
      sessionId: session.id,
      organizationId,
    })
    return
  }

  const stripe = requireStripeClient()
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
  const paymentMethodId = getPaymentMethodId(setupIntent.payment_method)
  if (setupIntent.status !== 'succeeded' || !paymentMethodId) {
    logger.warn('Enterprise auto-pay setup did not save a payment method', {
      sessionId: session.id,
      setupIntentStatus: setupIntent.status,
    })
    return
  }

  const customerId = contract.stripeCustomerId
  // Admin changes to the contract hold this lease while they write Stripe, so re-reading Stripe's
  // terms under it sees a self-serve shutdown that landed after the local check above.
  const switched = await withEnterpriseReconciliationLease(stripeSubscriptionId, async () => {
    const current = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    if (
      current.metadata?.referenceId !== organizationId ||
      !isSelfServeEnterpriseMetadata(current.metadata)
    ) {
      return false
    }
    await stripe.customers.update(
      customerId,
      { invoice_settings: { default_payment_method: paymentMethodId } },
      { idempotencyKey: `enterprise-auto-pay:${session.id}:customer` }
    )
    await stripe.subscriptions.update(
      stripeSubscriptionId,
      { collection_method: 'charge_automatically', default_payment_method: paymentMethodId },
      { idempotencyKey: `enterprise-auto-pay:${session.id}:subscription` }
    )
    return true
  })
  if (!switched) {
    logger.warn('Enterprise contract left self-serve before auto-pay could switch', {
      sessionId: session.id,
      organizationId,
    })
    return
  }

  logger.info('Enterprise contract switched to automatic payment', {
    organizationId,
    stripeSubscriptionId,
    paymentMethodId,
  })
}
