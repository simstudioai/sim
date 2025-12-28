import Stripe from 'stripe'
import type { CustomerDeleteResponse, DeleteCustomerParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Delete Customer Tool
 * Uses official stripe SDK to permanently delete customers
 */

export const stripeDeleteCustomerTool: ToolConfig<DeleteCustomerParams, CustomerDeleteResponse> = {
  id: 'stripe_delete_customer',
  name: 'Stripe Delete Customer',
  description: 'Permanently delete a customer',
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
   * Permanently deletes customer record
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Delete customer using SDK
      const deletionConfirmation = await stripe.customers.del(params.id)

      return {
        success: true,
        output: {
          deleted: deletionConfirmation.deleted,
          id: deletionConfirmation.id,
          metadata: {
            id: deletionConfirmation.id,
            deleted: deletionConfirmation.deleted,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_DELETE_CUSTOMER_ERROR',
          message: error.message || 'Failed to delete customer',
          details: error,
        },
      }
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the customer was deleted',
    },
    id: {
      type: 'string',
      description: 'The ID of the deleted customer',
    },
    metadata: {
      type: 'json',
      description: 'Deletion metadata',
    },
  },
}
