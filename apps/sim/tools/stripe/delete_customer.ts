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
      visibility: 'user-only',
      description: 'Customer ID (e.g., cus_1234567890) - requires human confirmation for deletion',
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
        apiVersion: '2025-08-27.basil',
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
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_DELETE_CUSTOMER_ERROR: Failed to delete customer - ${errorDetails}`,
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
