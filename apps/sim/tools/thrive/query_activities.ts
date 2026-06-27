import type {
  ThriveQueryActivitiesParams,
  ThriveQueryActivitiesResponse,
} from '@/tools/thrive/types'
import {
  THRIVE_ACTIVITY_OUTPUT_PROPERTIES,
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const queryActivitiesTool: ToolConfig<
  ThriveQueryActivitiesParams,
  ThriveQueryActivitiesResponse
> = {
  id: 'thrive_query_activities',
  name: 'Thrive Query Activities',
  description: 'Query activity records in Thrive with pagination and filtering options.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (default 1)',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (1-1000, default 20)',
    },
    actions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'comma-separated activity types e.g. viewed,completed',
    },
    omitActions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'comma-separated activity types e.g. viewed,completed',
    },
    contentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'comma-separated content IDs',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by content type',
    },
    timestampFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'format YYYY-MM-DD hh:mm:ss',
    },
    timestampTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'format YYYY-MM-DD hh:mm:ss',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/activities`)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'actions', params.actions)
      appendThriveQuery(url, 'omitActions', params.omitActions)
      appendThriveQuery(url, 'contentIds', params.contentIds)
      appendThriveQuery(url, 'contentType', params.contentType)
      appendThriveQuery(url, 'timestampFrom', params.timestampFrom)
      appendThriveQuery(url, 'timestampTo', params.timestampTo)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveQueryActivitiesResponse> => {
    const data = await parseThriveResponse(response, 'Failed to query activities')
    return {
      success: true,
      output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'The matching activity records',
      items: { type: 'object', properties: THRIVE_ACTIVITY_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
