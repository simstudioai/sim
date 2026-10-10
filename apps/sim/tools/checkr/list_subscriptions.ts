import {
  type CheckrListSubscriptionsParams,
  type CheckrListSubscriptionsResponse,
  LIST_META_OUTPUTS,
  SUBSCRIPTION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapListMeta,
  mapSubscription,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListSubscriptionsTool: ToolConfig<
  CheckrListSubscriptionsParams,
  CheckrListSubscriptionsResponse
> = {
  id: 'checkr_list_subscriptions',
  name: 'Checkr List Subscriptions',
  description:
    'List recurring check subscriptions, optionally filtered by candidate, status, or creation date.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return subscriptions for this candidate ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return subscriptions with this status (active, inactive)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return subscriptions created after this date',
    },
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return subscriptions created before this date',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl('/subscriptions', {
        candidate_id: params.candidateId,
        status: params.status,
        created_after: params.createdAfter,
        created_before: params.createdBefore,
        ...checkrPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        subscriptions: (Array.isArray(data.data) ? data.data : []).map(mapSubscription),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    subscriptions: {
      type: 'array',
      description: 'Matching subscriptions',
      items: { type: 'object', properties: SUBSCRIPTION_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
