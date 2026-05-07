import type {
  DeferGoogleSubscriptionParams,
  DeferGoogleSubscriptionResponse,
} from '@/tools/revenuecat/types'
import { SUBSCRIBER_OUTPUT, throwIfRevenueCatError } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatDeferGoogleSubscriptionTool: ToolConfig<
  DeferGoogleSubscriptionParams,
  DeferGoogleSubscriptionResponse
> = {
  id: 'revenuecat_defer_google_subscription',
  name: 'RevenueCat Defer Google Subscription',
  description:
    'Defer a Google Play subscription by extending its billing date by a number of days (Google Play only)',
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
      description:
        'The Google Play product identifier of the subscription to defer (use the part before the colon for products set up after Feb 2023)',
    },
    extendByDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of days to extend the subscription by (1-365). Provide either extendByDays or expiryTimeMs.',
    },
    expiryTimeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Absolute new expiry time in milliseconds since Unix epoch. Use instead of extendByDays to set an exact expiry.',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}/subscriptions/${encodeURIComponent(params.productId.trim())}/defer`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.extendByDays !== undefined) body.extend_by_days = params.extendByDays
      if (params.expiryTimeMs !== undefined) body.expiry_time_ms = params.expiryTimeMs
      return body
    },
  },

  transformResponse: async (response) => {
    await throwIfRevenueCatError(response)
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
      description: 'The updated subscriber object after deferring the Google subscription',
    },
  },
}
