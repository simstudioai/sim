import type {
  UpdateSubscriberAttributesParams,
  UpdateSubscriberAttributesResponse,
} from '@/tools/revenuecat/types'
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
        'JSON object of attributes to set. Each key maps to an object with a "value" field. Example: {"$email": {"value": "user@example.com"}, "$displayName": {"value": "John"}}',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}/attributes`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const attributes =
        typeof params.attributes === 'string' ? JSON.parse(params.attributes) : params.attributes
      return { attributes }
    },
  },

  transformResponse: async (response, params) => {
    return {
      success: response.ok,
      output: {
        updated: response.ok,
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
