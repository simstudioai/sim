import type { ThriveListAudiencesParams, ThriveListAudiencesResponse } from '@/tools/thrive/types'
import {
  THRIVE_AUDIENCE_OUTPUT_PROPERTIES,
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const listAudiencesTool: ToolConfig<ThriveListAudiencesParams, ThriveListAudiencesResponse> =
  {
    id: 'thrive_list_audiences',
    name: 'Thrive List Audiences',
    description: 'List audiences and structures in Thrive with pagination.',
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
      apiControlled: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to only return audiences which are / are not API controlled',
      },
      updatedSince: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return only audiences updated on or after this date/time (ISO 8601)',
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
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results to page through (1-100, default 100)',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/audiences`)
        appendThriveQuery(url, 'apiControlled', params.apiControlled)
        appendThriveQuery(url, 'updatedSince', params.updatedSince)
        appendThriveQuery(url, 'page', params.page)
        appendThriveQuery(url, 'perPage', params.perPage)
        appendThriveQuery(url, 'limit', params.limit)
        return url.toString()
      },
      method: 'GET',
      headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    },

    transformResponse: async (response: Response): Promise<ThriveListAudiencesResponse> => {
      const data = await parseThriveResponse(response, 'Failed to list audiences')
      return {
        success: true,
        output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
      }
    },

    outputs: {
      results: {
        type: 'array',
        description: 'The matching audiences',
        items: { type: 'object', properties: THRIVE_AUDIENCE_OUTPUT_PROPERTIES },
      },
      pagination: {
        type: 'object',
        description: 'Pagination details',
        properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
      },
    },
  }
