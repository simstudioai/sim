import type { ThriveQueryContentParams, ThriveQueryContentResponse } from '@/tools/thrive/types'
import {
  THRIVE_CONTENT_OUTPUT_PROPERTIES,
  THRIVE_PAGINATION_OUTPUT_PROPERTIES,
} from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const queryContentTool: ToolConfig<ThriveQueryContentParams, ThriveQueryContentResponse> = {
  id: 'thrive_query_content',
  name: 'Thrive Query Content',
  description: 'Query content records in Thrive with pagination and filtering options.',
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
    types: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated content types (article, assessment, broadcast, cmi5, elearning, event, file, pathway, question, quiz, scorm, url, video, mixed). If both set, omitTypes is ignored.',
    },
    omitTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated content types (article, assessment, broadcast, cmi5, elearning, event, file, pathway, question, quiz, scorm, url, video, mixed). If both set, omitTypes is ignored.',
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
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/contents`)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'types', params.types)
      appendThriveQuery(url, 'omitTypes', params.omitTypes)
      appendThriveQuery(url, 'updatedSince', params.updatedSince)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveQueryContentResponse> => {
    const data = await parseThriveResponse(response, 'Failed to query content')
    return {
      success: true,
      output: { results: data?.results ?? [], pagination: data?.pagination ?? null },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'The matching content records',
      items: { type: 'object', properties: THRIVE_CONTENT_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: THRIVE_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
