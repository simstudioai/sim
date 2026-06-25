import type {
  ThriveCpdPaginatedResponse,
  ThriveQueryCpdCategoriesParams,
} from '@/tools/thrive/types'
import {
  THRIVE_CPD_CATEGORY_OUTPUT_PROPERTIES,
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const queryCpdCategoriesTool: ToolConfig<
  ThriveQueryCpdCategoriesParams,
  ThriveCpdPaginatedResponse
> = {
  id: 'thrive_query_cpd_categories',
  name: 'Thrive Query CPD Categories',
  description: 'Query CPD categories in Thrive and return results with pagination.',
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
      description: 'Return only items updated on or after this date/time (ISO 8601)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/cpdCategories`)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'updatedSince', params.updatedSince)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveCpdPaginatedResponse> => {
    const data = await parseThriveResponse(response, 'Failed to query CPD categories')
    return {
      success: true,
      output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'The matching CPD categories',
      items: { type: 'object', properties: THRIVE_CPD_CATEGORY_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
