import type { ThriveSearchUsersParams, ThriveSearchUsersResponse } from '@/tools/thrive/types'
import {
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
  THRIVE_USER_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const searchUsersTool: ToolConfig<ThriveSearchUsersParams, ThriveSearchUsersResponse> = {
  id: 'thrive_search_users',
  name: 'Thrive Search Users',
  description: 'Search users in Thrive and return basic user information with pagination.',
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
      description: 'Number of results per page (1-1000, default 100)',
    },
    updatedSince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only users updated on or after this date/time (ISO 8601)',
    },
    statuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to include: active, inactive, expired, new',
    },
    omitStatuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to exclude: active, inactive, expired, new',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by a single status: active, inactive, expired, or new',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/users`)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'updatedSince', params.updatedSince)
      appendThriveQuery(url, 'statuses', params.statuses)
      appendThriveQuery(url, 'omitStatuses', params.omitStatuses)
      appendThriveQuery(url, 'status', params.status)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveSearchUsersResponse> => {
    const data = await parseThriveResponse(response, 'Failed to search users')
    return {
      success: true,
      output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'The matching users',
      items: { type: 'object', properties: THRIVE_USER_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
