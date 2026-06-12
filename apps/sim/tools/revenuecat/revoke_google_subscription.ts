import type {
  RevokeGoogleSubscriptionParams,
  RevokeGoogleSubscriptionResponse,
} from '@/tools/revenuecat/types'
import {
  extractSubscriber,
  SUBSCRIBER_OUTPUT,
  shapeSubscriber,
  throwIfRevenueCatError,
} from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatRevokeGoogleSubscriptionTool: ToolConfig<
  RevokeGoogleSubscriptionParams,
  RevokeGoogleSubscriptionResponse
> = {
  id: 'revenuecat_revoke_google_subscription',
  name: 'RevenueCat Revoke Google Subscription',
  description:
    'Immediately revoke access to a Google Play subscription and issue a refund (Google Play only)',
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
      description: 'The Google Play product identifier of the subscription to revoke',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}/subscriptions/${encodeURIComponent(params.productId.trim())}/revoke`,
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
      description: 'The updated subscriber object after revoking the Google subscription',
    },
  },
}
