import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { CustomerResponse, UpdateCustomerParams } from '@/tools/stripe/types'
import { CUSTOMER_METADATA_OUTPUT_PROPERTIES, CUSTOMER_OUTPUT } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const DELIVERY = defineStripeKeyedSite(
  'stripe_update_customer',
  'the edit would be re-applied over any change made to the customer in between, reverting the newer billing details'
)

export const stripeUpdateCustomerTool: ToolConfig<
  UpdateCustomerParams & StripeDeliveryContextParams,
  CustomerResponse
> = {
  id: 'stripe_update_customer',
  name: 'Stripe Update Customer',
  description: 'Update an existing customer',
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
      description: 'Customer ID (e.g., cus_1234567890)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated email address',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated phone number',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    address: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated address object',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/customers/${safeUrlPathSegment(params.id, 'id')}`,
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

      if (params.email) formData.append('email', params.email)
      if (params.name) formData.append('name', params.name)
      if (params.phone) formData.append('phone', params.phone)
      if (params.description) formData.append('description', params.description)

      if (params.address) {
        Object.entries(params.address).forEach(([key, value]) => {
          if (value) formData.append(`address[${key}]`, String(value))
        })
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
        customer: data,
        metadata: {
          id: data.id,
          email: data.email ?? null,
          name: data.name ?? null,
        },
      },
    }
  },

  outputs: {
    customer: {
      ...CUSTOMER_OUTPUT,
      description: 'The updated customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
      properties: CUSTOMER_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
