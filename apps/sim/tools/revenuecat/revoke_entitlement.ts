import type { RevokeEntitlementParams, RevokeEntitlementResponse } from '@/tools/revenuecat/types'
import { SUBSCRIBER_OUTPUT } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatRevokeEntitlementTool: ToolConfig<
  RevokeEntitlementParams,
  RevokeEntitlementResponse
> = {
  id: 'revenuecat_revoke_entitlement',
  name: 'RevenueCat Revoke Entitlement',
  description: 'Revoke all promotional entitlements for a specific entitlement identifier',
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
      description: 'The entitlement identifier to revoke',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}/entitlements/${encodeURIComponent(params.entitlementIdentifier)}/revoke_promotionals`,
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
      description: 'The updated subscriber object after revoking the entitlement',
    },
  },
}
