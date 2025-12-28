import Stripe from 'stripe'
import type { CreatePriceParams, PriceResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Price Tool
 * Uses official stripe SDK for price creation with recurring billing support
 */

export const stripeCreatePriceTool: ToolConfig<CreatePriceParams, PriceResponse> = {
  id: 'stripe_create_price',
  name: 'Stripe Create Price',
  description: 'Create a new price for a product',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    product: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product ID (e.g., prod_1234567890)',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code (e.g., usd, eur)',
    },
    unit_amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount in cents (e.g., 1000 for $10.00)',
    },
    recurring: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recurring billing configuration (interval: day/week/month/year)',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
    billing_scheme: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing scheme (per_unit or tiered)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates price with support for one-time and recurring billing
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare price data
      const priceData: Stripe.PriceCreateParams = {
        product: params.product,
        currency: params.currency,
      }

      if (params.unit_amount !== undefined) priceData.unit_amount = Number(params.unit_amount)
      if (params.billing_scheme) priceData.billing_scheme = params.billing_scheme as Stripe.PriceCreateParams.BillingScheme
      if (params.recurring) priceData.recurring = params.recurring as Stripe.PriceCreateParams.Recurring
      if (params.metadata) priceData.metadata = params.metadata

      // Create price using SDK
      const price = await stripe.prices.create(priceData)

      return {
        success: true,
        output: {
          price,
          metadata: {
            id: price.id,
            product: price.product as string,
            unit_amount: price.unit_amount,
            currency: price.currency,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_CREATE_PRICE_ERROR',
          message: error.message || 'Failed to create price',
          details: error,
        },
      }
    }
  },

  outputs: {
    price: {
      type: 'json',
      description: 'The created price object',
    },
    metadata: {
      type: 'json',
      description: 'Price metadata',
    },
  },
}
