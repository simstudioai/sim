import {
  mapPagination,
  mapTimeOff,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneTimeOffListParams,
  type RocketlaneTimeOffListResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_OFF_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListTimeOffsTool: ToolConfig<
  RocketlaneTimeOffListParams,
  RocketlaneTimeOffListResponse
> = {
  id: 'rocketlane_list_time_offs',
  name: 'Rocketlane List Time-Offs',
  description:
    'List time-offs in Rocketlane with optional date, type, and user filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of time-offs per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response (valid for 15 minutes)',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional fields to include in the response: note, notifyUsers',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by: startDate, endDate, or createdAt',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC (defaults to DESC)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Combine filters with AND (all) or OR (any); defaults to all',
    },
    startDateGt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with start dates greater than this date (YYYY-MM-DD)',
    },
    startDateEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with start dates equal to this date (YYYY-MM-DD)',
    },
    startDateLt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with start dates lesser than this date (YYYY-MM-DD)',
    },
    startDateGe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return time-offs with start dates greater than or equal to this date (YYYY-MM-DD)',
    },
    startDateLe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return time-offs with start dates lesser than or equal to this date (YYYY-MM-DD)',
    },
    endDateGt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with end dates greater than this date (YYYY-MM-DD)',
    },
    endDateEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with end dates equal to this date (YYYY-MM-DD)',
    },
    endDateLt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with end dates lesser than this date (YYYY-MM-DD)',
    },
    endDateGe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return time-offs with end dates greater than or equal to this date (YYYY-MM-DD)',
    },
    endDateLe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs with end dates lesser than or equal to this date (YYYY-MM-DD)',
    },
    typeEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs matching this type: FULL_DAY, HALF_DAY, or CUSTOM',
    },
    typeOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated time-off types to match any of (FULL_DAY, HALF_DAY, CUSTOM)',
    },
    typeNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated time-off types to match none of (FULL_DAY, HALF_DAY, CUSTOM)',
    },
    userIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs that exactly match this user ID',
    },
    userIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to match any of',
    },
    userIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to match none of',
    },
    emailIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return time-offs that exactly match this user email',
    },
    emailIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user emails to match any of',
    },
    emailIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user emails to match none of',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/time-offs`)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields?.length) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.startDateGt) url.searchParams.set('startDate.gt', params.startDateGt)
      if (params.startDateEq) url.searchParams.set('startDate.eq', params.startDateEq)
      if (params.startDateLt) url.searchParams.set('startDate.lt', params.startDateLt)
      if (params.startDateGe) url.searchParams.set('startDate.ge', params.startDateGe)
      if (params.startDateLe) url.searchParams.set('startDate.le', params.startDateLe)
      if (params.endDateGt) url.searchParams.set('endDate.gt', params.endDateGt)
      if (params.endDateEq) url.searchParams.set('endDate.eq', params.endDateEq)
      if (params.endDateLt) url.searchParams.set('endDate.lt', params.endDateLt)
      if (params.endDateGe) url.searchParams.set('endDate.ge', params.endDateGe)
      if (params.endDateLe) url.searchParams.set('endDate.le', params.endDateLe)
      if (params.typeEq) url.searchParams.set('type.eq', params.typeEq)
      if (params.typeOneOf) url.searchParams.set('type.oneOf', params.typeOneOf)
      if (params.typeNoneOf) url.searchParams.set('type.noneOf', params.typeNoneOf)
      if (params.userIdEq) url.searchParams.set('userId.eq', params.userIdEq)
      if (params.userIdOneOf) url.searchParams.set('userId.oneOf', params.userIdOneOf)
      if (params.userIdNoneOf) url.searchParams.set('userId.noneOf', params.userIdNoneOf)
      if (params.emailIdEq) url.searchParams.set('emailId.eq', params.emailIdEq)
      if (params.emailIdOneOf) url.searchParams.set('emailId.oneOf', params.emailIdOneOf)
      if (params.emailIdNoneOf) url.searchParams.set('emailId.noneOf', params.emailIdNoneOf)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    const timeOffs = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        timeOffs: timeOffs.map(mapTimeOff),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    timeOffs: {
      type: 'array',
      description: 'List of time-offs',
      items: { type: 'object', properties: TIME_OFF_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
