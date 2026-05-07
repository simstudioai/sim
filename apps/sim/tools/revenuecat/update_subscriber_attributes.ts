import type {
  UpdateSubscriberAttributesParams,
  UpdateSubscriberAttributesResponse,
} from '@/tools/revenuecat/types'
import { throwIfRevenueCatError } from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatUpdateSubscriberAttributesTool: ToolConfig<
  UpdateSubscriberAttributesParams,
  UpdateSubscriberAttributesResponse
> = {
  id: 'revenuecat_update_subscriber_attributes',
  name: 'RevenueCat Update Subscriber Attributes',
  description:
    'Update custom subscriber attributes (e.g., $email, $displayName, or custom key-value pairs)',
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
    attributes: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of attributes to set. Each key maps to an object with "value" (string; null or empty deletes the attribute) and "updated_at_ms" (Unix epoch ms used for conflict resolution — required). Example: {"$email": {"value": "user@example.com", "updated_at_ms": 1709195668093}}',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId.trim())}/attributes`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let attributes: unknown
      if (typeof params.attributes === 'string') {
        try {
          attributes = JSON.parse(params.attributes)
        } catch {
          throw new Error('attributes must be a valid JSON object')
        }
      } else {
        attributes = params.attributes
      }
      return { attributes }
    },
  },

  transformResponse: async (response, params) => {
    await throwIfRevenueCatError(response)
    return {
      success: true,
      output: {
        updated: true,
        app_user_id: params?.appUserId ?? '',
      },
    }
  },

  outputs: {
    updated: {
      type: 'boolean',
      description: 'Whether the subscriber attributes were successfully updated',
    },
    app_user_id: {
      type: 'string',
      description: 'The app user ID of the updated subscriber',
    },
  },
}
