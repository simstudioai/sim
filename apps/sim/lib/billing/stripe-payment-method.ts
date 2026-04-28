import { createLogger } from '@sim/logger'
import type Stripe from 'stripe'

const logger = createLogger('StripePaymentMethod')

/**
 * Extract the payment-method id from any of the shapes Stripe returns
 * for a `default_payment_method` field (id string, full object, null,
 * or undefined).
 */
function getPaymentMethodId(
  pm: string | Stripe.PaymentMethod | null | undefined
): string | undefined {
  return typeof pm === 'string' ? pm : pm?.id
}

/**
 * Extract the customer id from any of the shapes Stripe returns for a
 * `customer` field (id string, full `Customer`, or `DeletedCustomer`).
 */
export function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | undefined {
  if (!customer) return undefined
  return typeof customer === 'string' ? customer : customer.id
}

/**
 * Resolve a subscription's default payment method with fallback to the
 * customer's invoice-settings PM. Used for ad-hoc invoices that are
 * not directly linked to the subscription (overage, credits, threshold
 * billing) so Stripe can auto-collect on finalize.
 *
 * Returns both the resolved PM id and the subscription's collection
 * method so callers can pass it through to `invoices.create` without a
 * second subscription retrieve. On any Stripe error the returned
 * `collectionMethod` is `null` — callers should treat that as
 * "unknown" and handle accordingly rather than assuming a default.
 */
export async function resolveDefaultPaymentMethod(
  stripe: Stripe,
  stripeSubscriptionId: string,
  customerId: string
): Promise<{
  paymentMethodId: string | undefined
  collectionMethod: 'charge_automatically' | 'send_invoice' | null
}> {
  let collectionMethod: 'charge_automatically' | 'send_invoice' | null = null
  let paymentMethodId: string | undefined

  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    collectionMethod =
      sub.collection_method === 'send_invoice' ? 'send_invoice' : 'charge_automatically'
    paymentMethodId = getPaymentMethodId(sub.default_payment_method)

    if (!paymentMethodId && collectionMethod === 'charge_automatically') {
      const customer = await stripe.customers.retrieve(customerId)
      if (customer && !('deleted' in customer)) {
        paymentMethodId = getPaymentMethodId(
          (customer as Stripe.Customer).invoice_settings?.default_payment_method
        )
      }
    }
  } catch (error) {
    logger.warn('Failed to resolve default payment method', {
      stripeSubscriptionId,
      customerId,
      error: error instanceof Error ? error.message : error,
    })
  }

  return { paymentMethodId, collectionMethod }
}
