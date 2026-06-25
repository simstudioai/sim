import type {
  ThriveListAssignmentsParams,
  ThriveListAssignmentsResponse,
} from '@/tools/thrive/types'
import { THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const listAssignmentsTool: ToolConfig<
  ThriveListAssignmentsParams,
  ThriveListAssignmentsResponse
> = {
  id: 'thrive_list_assignments',
  name: 'Thrive List Assignments',
  description: 'List compliance assignments in Thrive, optionally filtered by audience.',
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
    audienceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by audience ID or audience reference',
    },
    updatedSince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only items updated on or after this date/time (ISO 8601)',
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
      description: 'Number of results per page (1-100, default 100)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to retrieve per page (1-100, default 100)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getThriveBaseUrl(params.host, 'v1')}/assignments`)
      appendThriveQuery(url, 'audienceId', params.audienceId)
      appendThriveQuery(url, 'updatedSince', params.updatedSince)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      appendThriveQuery(url, 'limit', params.limit)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveListAssignmentsResponse> => {
    const data = await parseThriveResponse(response, 'Failed to list assignments')
    return { success: true, output: { assignments: Array.isArray(data) ? data : [] } }
  },

  outputs: {
    assignments: {
      type: 'array',
      description: 'The matching assignments',
      items: { type: 'object', properties: THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES },
    },
  },
}
