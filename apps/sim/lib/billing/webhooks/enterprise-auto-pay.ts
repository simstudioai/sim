import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getCustomerId, getPaymentMethodId } from '@/lib/billing/stripe-payment-method'
import {
  hasUsableSubscriptionStatus,
  isEnterpriseSelfServe,
} from '@/lib/billing/subscriptions/utils'

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
    !hasUsableSubscriptionStatus(contract.status)
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

  logger.info('Enterprise contract switched to automatic payment', {
    organizationId,
    stripeSubscriptionId,
    paymentMethodType: setupIntent.payment_method_types[0],
  })
}
