import type {
  KetchGetSubscriptionsParams,
  KetchGetSubscriptionsResponse,
} from '@/tools/ketch/types'
import type { ToolConfig } from '@/tools/types'

export const getSubscriptionsTool: ToolConfig<
  KetchGetSubscriptionsParams,
  KetchGetSubscriptionsResponse
> = {
  id: 'ketch_get_subscriptions',
  name: 'Ketch Get Subscriptions',
  description:
    'Retrieve subscription preferences for a data subject. Returns the current subscription topic and control statuses.',
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
  },

  request: {
    url: (params) =>
      `https://global.ketchcdn.com/web/v2/subscriptions/${encodeURIComponent(params.organizationCode.trim())}/get`,
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      organizationCode: params.organizationCode.trim(),
      propertyCode: params.propertyCode,
      environmentCode: params.environmentCode,
      identities: params.identities,
    }),
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
          topics: {},
          controls: {},
        },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        topics: data.topics ?? {},
        controls: data.controls ?? {},
      },
    }
  },

  outputs: {
    topics: {
      type: 'object',
      description:
        'Map of topic codes to contact method settings (e.g., {"newsletter": {"email": {"status": "granted"}}})',
    },
    controls: {
      type: 'object',
      description:
        'Map of control codes to settings (e.g., {"global_unsubscribe": {"status": "denied"}})',
    },
  },
}
