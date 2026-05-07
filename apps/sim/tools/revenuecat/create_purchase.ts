import type { CreatePurchaseParams, CreatePurchaseResponse } from '@/tools/revenuecat/types'
import {
  extractCustomer,
  extractSubscriber,
  SUBSCRIBER_OUTPUT,
  shapeSubscriber,
  throwIfRevenueCatError,
} from '@/tools/revenuecat/types'
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
        'For iOS, the base64-encoded receipt (or JWSTransaction for StoreKit2); for Android the purchase token; for Amazon the receipt; for Stripe the subscription ID or Checkout Session ID; for Roku the transaction ID; for Paddle the subscription ID or transaction ID',
    },
    productId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Apple, Google, Amazon, Roku, or Paddle product identifier or SKU. Required for Google.',
    },
    price: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Price of the product. Required if you provide a currency.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 currency code (e.g., USD, EUR). Required if you provide a price.',
    },
    isRestore: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deprecated. Triggers configured restore behavior for shared fetch tokens.',
    },
    presentedOfferingIdentifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Identifier of the offering presented to the customer at the time of purchase. Attached to new transactions in this fetch token and exposed in ETL exports and webhooks.',
    },
    paymentMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Payment mode for the introductory period. One of: pay_as_you_go, pay_up_front, free_trial. Defaults to free_trial when an introductory period is detected and no value is provided.',
    },
    introductoryPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Introductory price paid (if any).',
    },
    attributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of subscriber attributes to set alongside the purchase. Each key maps to {"value": string, "updated_at_ms": number}.',
    },
    updatedAtMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UNIX epoch in milliseconds used to resolve attribute conflicts at the request level.',
    },
    platform: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Platform of the purchase. One of: ios, android, amazon, macos, uikitformac, stripe, roku, paddle. Sent as the X-Platform header (required by RevenueCat).',
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
      }
      if (params.productId) body.product_id = params.productId
      if (params.price !== undefined) body.price = params.price
      if (params.currency) body.currency = params.currency
      if (params.isRestore !== undefined) body.is_restore = params.isRestore
      if (params.presentedOfferingIdentifier) {
        body.presented_offering_identifier = params.presentedOfferingIdentifier
      }
      if (params.paymentMode) body.payment_mode = params.paymentMode
      if (params.introductoryPrice !== undefined) {
        body.introductory_price = params.introductoryPrice
      }
      if (params.attributes !== undefined && params.attributes !== '') {
        if (typeof params.attributes === 'string') {
          try {
            body.attributes = JSON.parse(params.attributes)
          } catch {
            throw new Error('attributes must be a valid JSON object')
          }
        } else {
          body.attributes = params.attributes
        }
      }
      if (params.updatedAtMs !== undefined) body.updated_at_ms = params.updatedAtMs
      return body
    },
  },

  transformResponse: async (response) => {
    await throwIfRevenueCatError(response)
    const data = await response.json()
    return {
      success: true,
      output: {
        customer: extractCustomer(data),
        subscriber: shapeSubscriber(extractSubscriber(data)),
      },
    }
  },

  outputs: {
    customer: {
      type: 'object',
      description:
        'Customer object returned at the top level of POST /v1/receipts (first_seen, last_seen, original_app_user_id, original_application_version, original_sdk_version, management_url, entitlements, original_purchase_date, request_date). Null when the response uses the `value`-wrapped envelope.',
      optional: true,
    },
    subscriber: {
      ...SUBSCRIBER_OUTPUT,
      description: 'The updated subscriber object after recording the purchase',
    },
  },
}
