import Stripe from 'stripe'
import type { CreateCustomerParams, CustomerResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Customer Tool
 * Uses official stripe SDK for customer creation
 */
export const stripeCreateCustomerTool: ToolConfig<CreateCustomerParams, CustomerResponse> = {
  id: 'stripe_create_customer',
  name: 'Stripe Create Customer',
  description: 'Create a new customer object',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer email address',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer full name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer phone number',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the customer',
    },
    address: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer address object',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
    payment_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID to attach',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates customer with full metadata support
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare customer data
      const customerData: Stripe.CustomerCreateParams = {}

      if (params.email) customerData.email = params.email
      if (params.name) customerData.name = params.name
      if (params.phone) customerData.phone = params.phone
      if (params.description) customerData.description = params.description
      if (params.payment_method) customerData.payment_method = params.payment_method
      if (params.address) customerData.address = params.address as Stripe.AddressParam
      if (params.metadata) customerData.metadata = params.metadata

      // Create customer using SDK
      const customer = await stripe.customers.create(customerData)

      return {
        success: true,
        output: {
          customer,
          metadata: {
            id: customer.id,
            email: customer.email,
            name: customer.name,
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
        error: `STRIPE_CUSTOMER_ERROR: Failed to create Stripe customer - ${errorDetails}`,
      }
    }
  },

  outputs: {
    customer: {
      type: 'json',
      description: 'The created customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
    },
  },
}
