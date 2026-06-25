import type {
  ThriveCpdPaginatedResponse,
  ThriveQueryCpdUserSummariesParams,
} from '@/tools/thrive/types'
import {
  THRIVE_CPD_USER_SUMMARY_OUTPUT_PROPERTIES,
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const queryCpdUserSummariesTool: ToolConfig<
  ThriveQueryCpdUserSummariesParams,
  ThriveCpdPaginatedResponse
> = {
  id: 'thrive_query_cpd_user_summaries',
  name: 'Thrive Query CPD User Summaries',
  description: 'Query CPD user log summaries in Thrive and return results with pagination.',
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
    entryDateFrom: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Filter entries after this date (format YYYY-MM-DDThh:mm:ss)',
    },
    entryDateTo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Filter entries before this date (format YYYY-MM-DDThh:mm:ss)',
    },
    userIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to filter by',
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
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/cpdUserLogSummaries`)
      appendThriveQuery(url, 'entryDateFrom', params.entryDateFrom)
      appendThriveQuery(url, 'entryDateTo', params.entryDateTo)
      appendThriveQuery(url, 'userIds', params.userIds)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveCpdPaginatedResponse> => {
    const data = await parseThriveResponse(response, 'Failed to query CPD user summaries')
    return {
      success: true,
      output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'The matching CPD user summaries',
      items: { type: 'object', properties: THRIVE_CPD_USER_SUMMARY_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
