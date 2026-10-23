import {
  type CheckrSubscriptionIdParams,
  type CheckrSubscriptionResponse,
  SUBSCRIPTION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapSubscription,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetSubscriptionTool: ToolConfig<
  CheckrSubscriptionIdParams,
  CheckrSubscriptionResponse
> = {
  id: 'checkr_get_subscription',
  name: 'Checkr Get Subscription',
  description: 'Retrieve a subscription by ID, including its schedule and next occurrence.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    subscriptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the subscription',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/subscriptions/${checkrId(params.subscriptionId, 'subscriptionId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { subscription: mapSubscription(data) } }
  },

  outputs: {
    subscription: {
      type: 'object',
      description: 'The subscription',
      properties: SUBSCRIPTION_PROPERTIES,
    },
  },
}
