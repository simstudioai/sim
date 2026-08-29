import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { SubscriptionResponse, UpdateSubscriptionParams } from '@/tools/stripe/types'
import { SUBSCRIPTION_METADATA_OUTPUT_PROPERTIES, SUBSCRIPTION_OUTPUT } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const DELIVERY = defineStripeKeyedSite(
  'stripe_update_subscription',
  'the subscription would be re-priced a second time, and an update that moves the billing cycle anchor invoices the customer again'
)

export const stripeUpdateSubscriptionTool: ToolConfig<
  UpdateSubscriptionParams & StripeDeliveryContextParams,
  SubscriptionResponse
> = {
  id: 'stripe_update_subscription',
  name: 'Stripe Update Subscription',
  description: 'Update an existing subscription',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subscription ID (e.g., sub_1234567890)',
    },
    items: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated array of items with price IDs',
    },
    cancel_at_period_end: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cancel subscription at period end',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  request: {
    url: (params) =>
      `https://api.stripe.com/v1/subscriptions/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'POST',
    /**
     * The `Idempotency-Key` must be the *same* on every delivery of one
     * instruction rather than fresh per attempt — it is what lets Stripe
     * recognize a resend and replay its first answer instead of acting again. A
     * value minted at request-build time is the inverse of the header's purpose:
     * it is stable only inside the transport loop, and every retry layer above
     * that re-enters tool preparation and looks to Stripe like a new write.
     */
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...stripeIdempotencyHeader(DELIVERY, params),
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.items && Array.isArray(params.items)) {
        params.items.forEach((item, index) => {
          formData.append(`items[${index}][price]`, item.price)
          if (item.quantity) {
            formData.append(`items[${index}][quantity]`, String(item.quantity))
          }
        })
      }

      if (params.cancel_at_period_end !== undefined) {
        formData.append('cancel_at_period_end', String(params.cancel_at_period_end))
      }

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
      }

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        subscription: data,
        metadata: {
          id: data.id,
          status: data.status,
          customer: data.customer,
        },
      },
    }
  },

  outputs: {
    subscription: {
      ...SUBSCRIPTION_OUTPUT,
      description: 'The updated subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
      properties: SUBSCRIPTION_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
