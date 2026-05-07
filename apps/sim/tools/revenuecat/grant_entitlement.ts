import type { GrantEntitlementParams, GrantEntitlementResponse } from '@/tools/revenuecat/types'
import {
  extractSubscriber,
  SUBSCRIBER_OUTPUT,
  shapeSubscriber,
  throwIfRevenueCatError,
} from '@/tools/revenuecat/types'
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deprecated. Duration of the entitlement. Provide either duration or endTimeMs (endTimeMs preferred). One of: daily, three_day, weekly, two_week, monthly, two_month, three_month, six_month, yearly, lifetime',
    },
    endTimeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Absolute end time in milliseconds since Unix epoch. Use instead of duration to grant the entitlement until a specific timestamp.',
    },
    startTimeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deprecated. Optional start time in milliseconds since Unix epoch, used with duration to determine expiration. Regardless of value, the entitlement is always granted immediately.',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}/entitlements/${encodeURIComponent(params.entitlementIdentifier.trim())}/promotional`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const hasEnd = params.endTimeMs !== undefined && (params.endTimeMs as unknown) !== ''
      const hasDuration = Boolean(params.duration)
      if (!hasDuration && !hasEnd) {
        throw new Error('Provide either duration or endTimeMs to grant a promotional entitlement')
      }
      if (hasDuration && hasEnd) {
        throw new Error('Provide only one of duration or endTimeMs — they cannot be used together')
      }
      const body: Record<string, unknown> = {}
      if (hasEnd) body.end_time_ms = params.endTimeMs
      else if (hasDuration) body.duration = params.duration
      if (params.startTimeMs !== undefined && (params.startTimeMs as unknown) !== '') {
        body.start_time_ms = params.startTimeMs
      }
      return body
    },
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
      description: 'The updated subscriber object after granting the entitlement',
    },
  },
}
