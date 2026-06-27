import type { ThriveListEnrolmentsParams, ThriveListEnrolmentsResponse } from '@/tools/thrive/types'
import { THRIVE_ENROLMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  appendThriveQuery,
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const listEnrolmentsTool: ToolConfig<
  ThriveListEnrolmentsParams,
  ThriveListEnrolmentsResponse
> = {
  id: 'thrive_list_enrolments',
  name: 'Thrive List Enrolments',
  description: 'List enrolments for a compliance assignment in Thrive.',
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
    assignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The assignment ID',
    },
    updatedAtFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date to filter enrolments from (ISO 8601)',
    },
    updatedAtTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date to filter enrolments up to (ISO 8601). Requires updatedAtFrom.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by enrolment status: archived, complete, open, overdue, scheduled, or unassigned',
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
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${getThriveBaseUrl(params.host, 'v1')}/assignments/${encodeURIComponent(params.assignmentId)}/enrolments`
      )
      appendThriveQuery(url, 'updatedAtFrom', params.updatedAtFrom)
      appendThriveQuery(url, 'updatedAtTo', params.updatedAtTo)
      appendThriveQuery(url, 'status', params.status)
      appendThriveQuery(url, 'page', params.page)
      appendThriveQuery(url, 'perPage', params.perPage)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveListEnrolmentsResponse> => {
    const data = await parseThriveResponse(response, 'Failed to list enrolments')
    return { success: true, output: { enrolments: Array.isArray(data) ? data : [] } }
  },

  outputs: {
    enrolments: {
      type: 'array',
      description: 'The matching enrolments',
      items: { type: 'object', properties: THRIVE_ENROLMENT_OUTPUT_PROPERTIES },
    },
  },
}
