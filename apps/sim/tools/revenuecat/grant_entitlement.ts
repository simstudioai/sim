import type { GrantEntitlementParams, GrantEntitlementResponse } from '@/tools/revenuecat/types'
import { SUBSCRIBER_OUTPUT } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatGrantEntitlementTool: ToolConfig<
  GrantEntitlementParams,
  GrantEntitlementResponse
> = {
  id: 'revenuecat_grant_entitlement',
  name: 'RevenueCat Grant Entitlement',
  description: 'Grant a promotional entitlement to a subscriber',
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
    entitlementIdentifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The entitlement identifier to grant',
    },
    duration: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Duration of the entitlement (daily, three_day, weekly, monthly, two_month, three_month, six_month, yearly, lifetime)',
    },
    startTimeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional start time in milliseconds since Unix epoch. Set to a past time to achieve custom durations shorter than daily.',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}/entitlements/${encodeURIComponent(params.entitlementIdentifier)}/promotional`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { duration: params.duration }
      if (params.startTimeMs !== undefined) body.start_time_ms = params.startTimeMs
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
        },
      },
    }
  },

  outputs: {
    subscriber: {
      ...SUBSCRIBER_OUTPUT,
      description: 'The updated subscriber object after granting the entitlement',
    },
  },
}
