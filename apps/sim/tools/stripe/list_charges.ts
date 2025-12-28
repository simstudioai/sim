import Stripe from 'stripe'
import type { ChargeListResponse, ListChargesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Charges Tool
 * Uses official stripe SDK for charge listing with pagination and filtering
 */

export const stripeListChargesTool: ToolConfig<ListChargesParams, ChargeListResponse> = {
  id: 'stripe_list_charges',
  name: 'Stripe List Charges',
  description: 'List all charges',
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
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by customer ID',
    },
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date (e.g., {"gt": 1633024800})',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Lists charges with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare list options
      const listOptions: Stripe.ChargeListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.customer) listOptions.customer = params.customer
      if (params.created) listOptions.created = params.created

      // List charges using SDK
      const chargeList = await stripe.charges.list(listOptions)

      return {
        success: true,
        output: {
          charges: chargeList.data || [],
          metadata: {
            count: chargeList.data.length,
            has_more: chargeList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_LIST_CHARGES_ERROR',
          message: error.message || 'Failed to list charges',
          details: error,
        },
      }
    }
  },

  outputs: {
    charges: {
      type: 'json',
      description: 'Array of Charge objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata including count and has_more',
    },
  },
}
