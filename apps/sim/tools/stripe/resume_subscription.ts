import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { ResumeSubscriptionParams, SubscriptionResponse } from '@/tools/stripe/types'
import { SUBSCRIPTION_METADATA_OUTPUT_PROPERTIES, SUBSCRIPTION_OUTPUT } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const DELIVERY = defineStripeKeyedSite(
  'stripe_resume_subscription',
  'the billing cycle would be re-anchored a second time, which can invoice the customer again'
)

export const stripeResumeSubscriptionTool: ToolConfig<
  ResumeSubscriptionParams & StripeDeliveryContextParams,
  SubscriptionResponse
> = {
  id: 'stripe_resume_subscription',
  name: 'Stripe Resume Subscription',
  description: 'Resume a subscription that was scheduled for cancellation',
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
  },

  request: {
    url: (params) =>
      `https://api.stripe.com/v1/subscriptions/${safeUrlPathSegment(params.id, 'id')}/resume`,
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
    body: () => {
      const formData = new URLSearchParams()
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
      description: 'The resumed subscription object',
    },
    metadata: {
      type: 'json',
      description: 'Subscription metadata including ID, status, and customer',
      properties: SUBSCRIPTION_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
