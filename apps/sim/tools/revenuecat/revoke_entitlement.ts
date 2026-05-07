import type { RevokeEntitlementParams, RevokeEntitlementResponse } from '@/tools/revenuecat/types'
import {
  extractSubscriber,
  SUBSCRIBER_OUTPUT,
  shapeSubscriber,
  throwIfRevenueCatError,
} from '@/tools/revenuecat/types'
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
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}/entitlements/${encodeURIComponent(params.entitlementIdentifier.trim())}/revoke_promotionals`,
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
      description: 'The updated subscriber object after revoking the entitlement',
    },
  },
}
