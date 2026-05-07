import type {
  RefundGoogleSubscriptionParams,
  RefundGoogleSubscriptionResponse,
} from '@/tools/revenuecat/types'
import {
  extractSubscriber,
  SUBSCRIBER_OUTPUT,
  shapeSubscriber,
  throwIfRevenueCatError,
} from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatRefundGoogleSubscriptionTool: ToolConfig<
  RefundGoogleSubscriptionParams,
  RefundGoogleSubscriptionResponse
> = {
  id: 'revenuecat_refund_google_subscription',
  name: 'RevenueCat Refund Google Subscription',
  description:
    'Refund a specific store transaction by its store transaction identifier and revoke access (subscription or non-subscription, last 365 days)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RevenueCat secret API key (sk_...)',
    },
    appUserId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The app user ID of the subscriber',
    },
    storeTransactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The store transaction identifier of the purchase to refund (e.g., GPA.3309-9122-6177-45730 for Google Play)',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}/transactions/${encodeURIComponent(params.storeTransactionId.trim())}/refund`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    await throwIfRevenueCatError(response)
    const data = await response.json()
    return {
      success: true,
      output: {
        subscriber: shapeSubscriber(extractSubscriber(data)),
      },
    }
  },

  outputs: {
    subscriber: {
      ...SUBSCRIBER_OUTPUT,
      description: 'The updated subscriber object after refunding the Google subscription',
    },
  },
}
