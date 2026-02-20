import type { CreatePurchaseParams, CreatePurchaseResponse } from '@/tools/revenuecat/types'
import { SUBSCRIBER_OUTPUT } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatCreatePurchaseTool: ToolConfig<
  CreatePurchaseParams,
  CreatePurchaseResponse
> = {
  id: 'revenuecat_create_purchase',
  name: 'RevenueCat Create Purchase',
  description: 'Record a purchase (receipt) for a subscriber via the REST API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RevenueCat API key (public or secret)',
    },
    appUserId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The app user ID of the subscriber',
    },
    fetchToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The receipt token or purchase token from the store (App Store receipt, Google Play purchase token, or Stripe subscription ID)',
    },
    productId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The product identifier for the purchase',
    },
    price: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The price of the product in the currency specified',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 currency code (e.g., USD, EUR)',
    },
    isRestore: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this is a restore of a previous purchase',
    },
    platform: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Platform of the purchase (ios, android, amazon, macos, stripe). Required for Stripe and Paddle purchases.',
    },
  },

  request: {
    url: () => 'https://api.revenuecat.com/v1/receipts',
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }
      if (params.platform) {
        headers['X-Platform'] = params.platform
      }
      return headers
    },
    body: (params) => {
      const body: Record<string, unknown> = {
        app_user_id: params.appUserId,
        fetch_token: params.fetchToken,
        product_id: params.productId,
      }
      if (params.price !== undefined) body.price = params.price
      if (params.currency) body.currency = params.currency
      if (params.isRestore !== undefined) body.is_restore = params.isRestore
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const subscriber = data.subscriber ?? {}

    return {
      success: true,
      output: {
        subscriber: {
          first_seen: subscriber.first_seen ?? '',
          original_app_user_id: subscriber.original_app_user_id ?? '',
          subscriptions: subscriber.subscriptions ?? {},
          entitlements: subscriber.entitlements ?? {},
          non_subscriptions: subscriber.non_subscriptions ?? {},
        },
      },
    }
  },

  outputs: {
    subscriber: {
      ...SUBSCRIBER_OUTPUT,
      description: 'The updated subscriber object after recording the purchase',
    },
  },
}
