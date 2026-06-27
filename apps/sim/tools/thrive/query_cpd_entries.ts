import type { ThriveCpdPaginatedResponse, ThriveQueryCpdEntriesParams } from '@/tools/thrive/types'
import {
  THRIVE_CPD_ENTRY_OUTPUT_PROPERTIES,
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const queryCpdEntriesTool: ToolConfig<
  ThriveQueryCpdEntriesParams,
  ThriveCpdPaginatedResponse
> = {
  id: 'thrive_query_cpd_entries',
  name: 'Thrive Query CPD Entries',
  description: 'Query CPD log entries in Thrive and return results with pagination.',
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
    entryDateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter entries after this date (format YYYY-MM-DD hh:mm:ss)',
    },
    entryDateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter entries before this date (format YYYY-MM-DD hh:mm:ss)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/cpdEntries`)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'entryDateFrom', params.entryDateFrom)
      appendThriveQuery(url, 'entryDateTo', params.entryDateTo)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveCpdPaginatedResponse> => {
    const data = await parseThriveResponse(response, 'Failed to query CPD entries')
    return {
      success: true,
      output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'The matching CPD entries',
      items: { type: 'object', properties: THRIVE_CPD_ENTRY_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
