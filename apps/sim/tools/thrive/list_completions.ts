import type {
  ThriveListCompletionsParams,
  ThriveListCompletionsResponse,
} from '@/tools/thrive/types'
import { THRIVE_COMPLETION_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const listCompletionsTool: ToolConfig<
  ThriveListCompletionsParams,
  ThriveListCompletionsResponse
> = {
  id: 'thrive_list_completions',
  name: 'Thrive List Completions',
  description:
    'List learning completion records in Thrive, optionally filtered by user or content.',
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
    contentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by content',
    },
    isRPL: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completions imported via Recognition of Prior Learning (RPL)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by user',
    },
    completedDateRangeStart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completedDate (completedDate >= this date/date-time)',
    },
    completedDateRangeEnd: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completedDate (completedDate <= this date/date-time)',
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
      description: 'Number of results per page (1-1000, default 1000)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to retrieve per page (1-1000, default 1000)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/learning/completions`)
      appendThriveQuery(url, 'contentId', params.contentId)
      appendThriveQuery(url, 'isRPL', params.isRPL)
      appendThriveQuery(url, 'userId', params.userId)
      appendThriveQuery(url, 'completedDateRangeStart', params.completedDateRangeStart)
      appendThriveQuery(url, 'completedDateRangeEnd', params.completedDateRangeEnd)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'limit', params.limit)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveListCompletionsResponse> => {
    const data = await parseThriveResponse(response, 'Failed to list completions')
    return { success: true, output: { completions: Array.isArray(data) ? data : [] } }
  },

  outputs: {
    completions: {
      type: 'array',
      description: 'The matching completion records',
      items: { type: 'object', properties: THRIVE_COMPLETION_OUTPUT_PROPERTIES },
    },
  },
}
