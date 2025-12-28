import Stripe from 'stripe'
import type { CustomerListResponse, ListCustomersParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Customers Tool
 * Uses official stripe SDK for customer listing with pagination and filtering
 */

export const stripeListCustomersTool: ToolConfig<ListCustomersParams, CustomerListResponse> = {
  id: 'stripe_list_customers',
  name: 'Stripe List Customers',
  description: 'List all customers',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by email address',
    },
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Lists customers with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare list options
      const listOptions: Stripe.CustomerListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.email) listOptions.email = params.email
      if (params.created) listOptions.created = params.created

      // List customers using SDK
      const customerList = await stripe.customers.list(listOptions)

      return {
        success: true,
        output: {
          customers: customerList.data || [],
          metadata: {
            count: customerList.data.length,
            has_more: customerList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_LIST_CUSTOMERS_ERROR',
          message: error.message || 'Failed to list customers',
          details: error,
        },
      }
    }
  },

  outputs: {
    customers: {
      type: 'json',
      description: 'Array of customer objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
