import type Stripe from 'stripe'
import { AUTO_PAY_RETURN_PARAM } from '@/lib/api/contracts/organization'
import { defineAuthorizedOrganizationBillingUseCase } from '@/lib/billing/application/organization-billing/authorized-organization-billing-use-case'
import { organizationBillingOperations } from '@/lib/billing/application/organization-billing/operations'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { isEnterpriseSelfServe } from '@/lib/billing/subscriptions/utils'
import { ENTERPRISE_AUTO_PAY_PURPOSE } from '@/lib/billing/webhooks/enterprise-auto-pay'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'

export interface EnterprisePaymentMethodInput {
  organizationId: string
}

export interface EnterprisePaymentMethodSummary {
  /** `charge_automatically` once the customer has turned on auto-pay; else emailed invoices. */
  collectionMethod: 'charge_automatically' | 'send_invoice'
  /** The method renewals, true-ups, and overage charge; null while the customer pays by invoice. */
  paymentMethod: { type: 'card' | 'us_bank_account' | 'other'; label: string } | null
}

export interface StartEnterpriseAutoPayInput {
  organizationId: string
  /** Where Stripe returns the customer; must be on this deployment's origin. */
  returnUrl: string
}

function withAutoPayReturnMarker(returnUrl: string): string {
  const url = new URL(returnUrl)
  url.searchParams.set(AUTO_PAY_RETURN_PARAM, 'true')
  return url.toString()
}

async function requireSelfServeEnterpriseSubscription(organizationId: string) {
  const subscription = await getOrganizationSubscription(organizationId, { onError: 'throw' })
  if (!subscription || !isEnterpriseSelfServe(subscription)) {
    throw new OrchestrationError(
      'forbidden',
      'Payment methods are managed by Sim for this organization. Contact your account team to make changes.'
    )
  }
  if (!subscription.stripeCustomerId || !subscription.stripeSubscriptionId) {
    throw new OrchestrationError('conflict', 'This contract is not linked to Stripe yet')
  }
  return {
    stripeCustomerId: subscription.stripeCustomerId,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  }
}

/** Stripe's lowercase slugs (`american_express`, `link`) as a customer reads them. */
function toDisplayName(slug: string): string {
  return slug
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function describePaymentMethod(
  paymentMethod: string | Stripe.PaymentMethod | null
): EnterprisePaymentMethodSummary['paymentMethod'] {
  if (!paymentMethod || typeof paymentMethod === 'string') return null
  if (paymentMethod.type === 'card' && paymentMethod.card) {
    const brand = toDisplayName(paymentMethod.card.display_brand ?? paymentMethod.card.brand)
    return { type: 'card', label: `${brand} •••• ${paymentMethod.card.last4}` }
  }
  if (paymentMethod.type === 'us_bank_account' && paymentMethod.us_bank_account) {
    const bank = paymentMethod.us_bank_account.bank_name ?? 'Bank account'
    return { type: 'us_bank_account', label: `${bank} •••• ${paymentMethod.us_bank_account.last4}` }
  }
  return { type: 'other', label: toDisplayName(paymentMethod.type) }
}

/** How a self-serve Enterprise contract pays: by emailed invoice, or automatically by a saved method. */
export const getEnterprisePaymentMethod = defineAuthorizedOrganizationBillingUseCase({
  operation: organizationBillingOperations.read,
  organizationId: (input: EnterprisePaymentMethodInput) => input.organizationId,
  async execute({ context }): Promise<EnterprisePaymentMethodSummary> {
    const { stripeSubscriptionId } = await requireSelfServeEnterpriseSubscription(
      context.organizationId
    )
    const stripeSubscription = await requireStripeClient().subscriptions.retrieve(
      stripeSubscriptionId,
      { expand: ['default_payment_method'] }
    )
    const autoPay = stripeSubscription.collection_method === 'charge_automatically'
    return {
      collectionMethod: autoPay ? 'charge_automatically' : 'send_invoice',
      paymentMethod: autoPay
        ? describePaymentMethod(stripeSubscription.default_payment_method)
        : null,
    }
  },
})

/**
 * Opens Stripe's hosted page that saves a card or US bank account without charging it. The
 * `checkout.session.completed` webhook then switches the contract to automatic payment.
 */
export const startEnterpriseAutoPaySetup = defineAuthorizedOrganizationBillingUseCase({
  operation: organizationBillingOperations.managePaymentMethod,
  organizationId: (input: StartEnterpriseAutoPayInput) => input.organizationId,
  async execute({ input, context }): Promise<{ url: string }> {
    if (new URL(input.returnUrl).origin !== new URL(getBaseUrl()).origin) {
      throw new OrchestrationError('validation', 'Return URL must be on this site')
    }
    const { stripeCustomerId, stripeSubscriptionId } = await requireSelfServeEnterpriseSubscription(
      context.organizationId
    )
    const metadata = {
      purpose: ENTERPRISE_AUTO_PAY_PURPOSE,
      organizationId: context.organizationId,
      stripeSubscriptionId,
      requestedByUserId: context.actorUserId,
    }
    const session = await requireStripeClient().checkout.sessions.create({
      mode: 'setup',
      customer: stripeCustomerId,
      currency: 'usd',
      payment_method_types: ['card', 'us_bank_account'],
      // Instant verification keeps the switch to auto-pay synchronous with the session.
      payment_method_options: { us_bank_account: { verification_method: 'instant' } },
      success_url: withAutoPayReturnMarker(input.returnUrl),
      cancel_url: input.returnUrl,
      metadata,
      setup_intent_data: { metadata },
    })
    if (!session.url) throw new OrchestrationError('internal', 'Stripe did not return a setup URL')
    return { url: session.url }
  },
})
