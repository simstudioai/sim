import type {
  RefundGoogleSubscriptionParams,
  RefundGoogleSubscriptionResponse,
} from '@/tools/revenuecat/types'
import { SUBSCRIBER_OUTPUT } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatRefundGoogleSubscriptionTool: ToolConfig<
  RefundGoogleSubscriptionParams,
  RefundGoogleSubscriptionResponse
> = {
  id: 'revenuecat_refund_google_subscription',
  name: 'RevenueCat Refund Google Subscription',
  description: 'Refund and optionally revoke a Google Play subscription (Google Play only)',
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
    productId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Google Play product identifier of the subscription to refund',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}/subscriptions/${encodeURIComponent(params.productId)}/refund`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
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
        },
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
