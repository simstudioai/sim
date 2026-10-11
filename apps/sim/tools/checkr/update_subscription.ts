import {
  type CheckrSubscriptionResponse,
  type CheckrUpdateSubscriptionParams,
  SUBSCRIPTION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  applyHierarchyFields,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_HIERARCHY_PARAMS,
  checkrHeaders,
  checkrId,
  checkrPositiveInteger,
  checkrUrl,
  mapSubscription,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrUpdateSubscriptionTool: ToolConfig<
  CheckrUpdateSubscriptionParams,
  CheckrSubscriptionResponse
> = {
  id: 'checkr_update_subscription',
  name: 'Checkr Update Subscription',
  description: 'Change the package, schedule, node, or work locations of a subscription.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    subscriptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the subscription to update',
    },
    package: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slug of the package to run on each occurrence',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date of the first check in YYYY-MM-DD format',
    },
    intervalCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of interval units between checks',
    },
    intervalUnit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Interval unit: day, week, month, or year',
    },
    ...CHECKR_HIERARCHY_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl(`/subscriptions/${checkrId(params.subscriptionId, 'subscriptionId')}`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const pkg = trimmed(params.package)
      if (pkg) body.package = pkg
      const startDate = trimmed(params.startDate)
      if (startDate) body.start_date = startDate
      const intervalCount = checkrPositiveInteger(params.intervalCount, 'intervalCount')
      if (intervalCount !== undefined) body.interval_count = intervalCount
      const intervalUnit = trimmed(params.intervalUnit)
      if (intervalUnit) body.interval_unit = intervalUnit
      applyHierarchyFields(body, params)
      if (Object.keys(body).length === 0) {
        throw new Error('Provide at least one subscription field to update.')
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { subscription: mapSubscription(data) } }
  },

  outputs: {
    subscription: {
      type: 'object',
      description: 'The updated subscription',
      properties: SUBSCRIPTION_PROPERTIES,
    },
  },
}
