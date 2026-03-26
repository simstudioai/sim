import type {
  KetchSetSubscriptionsParams,
  KetchSetSubscriptionsResponse,
} from '@/tools/ketch/types'
import type { ToolConfig } from '@/tools/types'

export const setSubscriptionsTool: ToolConfig<
  KetchSetSubscriptionsParams,
  KetchSetSubscriptionsResponse
> = {
  id: 'ketch_set_subscriptions',
  name: 'Ketch Set Subscriptions',
  description:
    'Update subscription preferences for a data subject. Sets topic and control statuses for email, SMS, and other contact methods.',
  version: '1.0.0',

  params: {
    organizationCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ketch organization code',
    },
    propertyCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Digital property code defined in Ketch',
    },
    environmentCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment code defined in Ketch (e.g., "production")',
    },
    identities: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity map (e.g., {"email": "user@example.com"})',
    },
    topics: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Map of topic codes to contact method settings (e.g., {"newsletter": {"email": {"status": "granted"}, "sms": {"status": "denied"}}})',
    },
    controls: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Map of control codes to settings (e.g., {"global_unsubscribe": {"status": "denied"}})',
    },
  },

  request: {
    url: (params) =>
      `https://global.ketchcdn.com/web/v2/subscriptions/${encodeURIComponent(params.organizationCode.trim())}/update`,
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        organizationCode: params.organizationCode.trim(),
        propertyCode: params.propertyCode,
        environmentCode: params.environmentCode,
        identities: params.identities,
      }
      if (params.topics) body.topics = params.topics
      if (params.controls) body.controls = params.controls
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`
      try {
        const data = await response.json()
        errorMessage = data.message ?? data.error ?? errorMessage
      } catch {
        // No JSON body in error response
      }
      return {
        success: false,
        output: {
          error: errorMessage,
          success: false,
        },
      }
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the subscription preferences were updated',
    },
  },
}
