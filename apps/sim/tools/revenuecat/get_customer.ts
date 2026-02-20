import type { CustomerResponse, GetCustomerParams } from '@/tools/revenuecat/types'
import { METADATA_OUTPUT_PROPERTIES, SUBSCRIBER_OUTPUT } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatGetCustomerTool: ToolConfig<GetCustomerParams, CustomerResponse> = {
  id: 'revenuecat_get_customer',
  name: 'RevenueCat Get Customer',
  description: 'Retrieve subscriber information by app user ID',
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
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const subscriber = data.subscriber ?? {}
    const entitlements = subscriber.entitlements ?? {}
    const subscriptions = subscriber.subscriptions ?? {}

    const activeEntitlements = Object.values(entitlements).filter(
      (e: unknown) => (e as Record<string, unknown>).is_active
    ).length
    const activeSubscriptions = Object.keys(subscriptions).length

    return {
      success: true,
      output: {
        subscriber: {
          first_seen: subscriber.first_seen ?? '',
          original_app_user_id: subscriber.original_app_user_id ?? '',
          original_purchase_date: subscriber.original_purchase_date ?? null,
          management_url: subscriber.management_url ?? null,
          subscriptions: subscriptions,
          entitlements: entitlements,
          non_subscriptions: subscriber.non_subscriptions ?? {},
        },
        metadata: {
          app_user_id: subscriber.original_app_user_id ?? '',
          first_seen: subscriber.first_seen ?? '',
          active_entitlements: activeEntitlements,
          active_subscriptions: activeSubscriptions,
        },
      },
    }
  },

  outputs: {
    subscriber: {
      ...SUBSCRIBER_OUTPUT,
      description: 'The subscriber object with subscriptions and entitlements',
    },
    metadata: {
      type: 'object',
      description: 'Subscriber summary metadata',
      properties: METADATA_OUTPUT_PROPERTIES,
    },
  },
}
