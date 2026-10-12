import {
  type CheckrCreateSubscriptionParams,
  type CheckrSubscriptionResponse,
  SUBSCRIPTION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  applyHierarchyFields,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_HIERARCHY_PARAMS,
  checkrHeaders,
  checkrPositiveInteger,
  checkrUrl,
  mapSubscription,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateSubscriptionTool: ToolConfig<
  CheckrCreateSubscriptionParams,
  CheckrSubscriptionResponse
> = {
  id: 'checkr_create_subscription',
  name: 'Checkr Create Subscription',
  description:
    'Schedule a recurring background check for a candidate, running a package every interval starting on a date.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate to screen',
    },
    package: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slug of the package to run on each occurrence',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date of the first check in YYYY-MM-DD format',
    },
    intervalCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of interval units between checks, e.g. 1',
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
    url: () => checkrUrl('/subscriptions'),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidate_id: trimmed(params.candidateId),
        package: trimmed(params.package),
        start_date: trimmed(params.startDate),
      }
      const intervalCount = checkrPositiveInteger(params.intervalCount, 'intervalCount')
      if (intervalCount !== undefined) body.interval_count = intervalCount
      const intervalUnit = trimmed(params.intervalUnit)
      if (intervalUnit) body.interval_unit = intervalUnit
      applyHierarchyFields(body, params)
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
      description: 'The created subscription',
      properties: SUBSCRIPTION_PROPERTIES,
    },
  },
}
