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

export const checkrCancelSubscriptionTool: ToolConfig<
  CheckrSubscriptionIdParams,
  CheckrSubscriptionResponse
> = {
  id: 'checkr_cancel_subscription',
  name: 'Checkr Cancel Subscription',
  description: 'Cancel a subscription so no further recurring checks run.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    subscriptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the subscription to cancel',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/subscriptions/${checkrId(params.subscriptionId, 'subscriptionId')}`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { subscription: mapSubscription(data) } }
  },

  outputs: {
    subscription: {
      type: 'object',
      description: 'The canceled subscription',
      properties: SUBSCRIPTION_PROPERTIES,
    },
  },
}
