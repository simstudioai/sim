import Stripe from 'stripe'
import type { CustomerResponse, RetrieveCustomerParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Customer Tool
 * Uses official stripe SDK for customer retrieval
 */

export const stripeRetrieveCustomerTool: ToolConfig<RetrieveCustomerParams, CustomerResponse> = {
  id: 'stripe_retrieve_customer',
  name: 'Stripe Retrieve Customer',
  description: 'Retrieve an existing customer by ID',
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
  },

  /**
   * SDK-based execution using stripe SDK
   * Retrieves customer by ID with full customer data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Retrieve customer using SDK
      const customer = await stripe.customers.retrieve(params.id)

      // Handle Customer | DeletedCustomer union type
      const customerData = customer.deleted ? null : (customer as Stripe.Customer)

      return {
        success: true,
        output: {
          customer,
          metadata: {
            id: customer.id,
            email: customerData?.email ?? null,
            name: customerData?.name ?? null,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_RETRIEVE_CUSTOMER_ERROR: Failed to retrieve customer - ${errorDetails}`,
      }
    }
  },

  outputs: {
    customer: {
      type: 'json',
      description: 'The retrieved customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
    },
  },
}
