import Stripe from 'stripe'
import type { CustomerResponse, UpdateCustomerParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Customer Tool
 * Uses official stripe SDK for customer updates
 */

export const stripeUpdateCustomerTool: ToolConfig<UpdateCustomerParams, CustomerResponse> = {
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

  /**
   * SDK-based execution using stripe SDK
   * Updates customer with optional fields
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare update data
      const updateData: Stripe.CustomerUpdateParams = {}
      if (params.email) updateData.email = params.email
      if (params.name) updateData.name = params.name
      if (params.phone) updateData.phone = params.phone
      if (params.description) updateData.description = params.description
      if (params.address) updateData.address = params.address as Stripe.AddressParam
      if (params.metadata) updateData.metadata = params.metadata

      // Update customer using SDK
      const customer = await stripe.customers.update(params.id, updateData)

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
      return {
        success: false,
        error: {
          code: 'STRIPE_UPDATE_CUSTOMER_ERROR',
          message: error.message || 'Failed to update customer',
          details: error,
        },
      }
    }
  },

  outputs: {
    customer: {
      type: 'json',
      description: 'The updated customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
    },
  },
}
