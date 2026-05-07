import type { CustomerResponse, GetCustomerParams } from '@/tools/revenuecat/types'
import {
  extractSubscriber,
  METADATA_OUTPUT_PROPERTIES,
  SUBSCRIBER_OUTPUT,
  shapeSubscriber,
  throwIfRevenueCatError,
} from '@/tools/revenuecat/types'
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
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    await throwIfRevenueCatError(response)
    const data = await response.json()
    const subscriberRaw = extractSubscriber(data)
    const subscriber = shapeSubscriber(subscriberRaw)
    const requestDate = (data?.value?.request_date ?? data?.request_date) as string | undefined
    const parsed = requestDate ? new Date(requestDate).getTime() : Number.NaN
    const now = Number.isFinite(parsed) ? parsed : Date.now()

    const isActiveByDates = (
      expires: string | null | undefined,
      grace: string | null | undefined,
      refundedAt?: string | null | undefined
    ) => {
      if (refundedAt) return false
      if (!expires) return true
      if (new Date(expires).getTime() > now) return true
      if (grace && new Date(grace).getTime() > now) return true
      return false
    }

    const activeEntitlements = Object.values(subscriber.entitlements).filter((e) => {
      const ent = e as Record<string, unknown>
      return isActiveByDates(
        ent.expires_date as string | null | undefined,
        ent.grace_period_expires_date as string | null | undefined
      )
    }).length

    const activeSubscriptions = Object.values(subscriber.subscriptions).filter((s) => {
      const sub = s as Record<string, unknown>
      return isActiveByDates(
        sub.expires_date as string | null | undefined,
        sub.grace_period_expires_date as string | null | undefined,
        sub.refunded_at as string | null | undefined
      )
    }).length

    return {
      success: true,
      output: {
        subscriber,
        metadata: {
          app_user_id: subscriber.original_app_user_id,
          first_seen: subscriber.first_seen,
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
