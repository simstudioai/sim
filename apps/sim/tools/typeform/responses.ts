import { TYPEFORM_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { TypeformResponsesParams, TypeformResponsesResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const responsesTool: ToolConfig<TypeformResponsesParams, TypeformResponsesResponse> = {
  id: 'typeform_responses',
  name: 'Typeform Responses',
  description: 'Retrieve form responses from Typeform',
  version: '1.0.0',
  oauth: TYPEFORM_CREDENTIAL_OAUTH,

  params: {
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Typeform form ID (e.g., "abc123XYZ")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of responses to retrieve (e.g., 10, 25, 50)',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor token for fetching the next page of older responses',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor token for fetching the next page of newer responses',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Retrieve responses submitted on or after this date (e.g., "2024-01-01T00:00:00Z")',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Retrieve responses submitted on or before this date (e.g., "2024-12-31T23:59:59Z")',
    },
    completed: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by completion status: "true" (submitted only), "false" (started but not submitted), or "all" (no filter sent, so Typeform returns submitted responses only). Ignored when responseType is set',
    },
    responseType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated response types to return (e.g., "partial,completed"). Typeform returns only "completed" when omitted. Takes precedence over completed',
    },
  },

  request: {
    url: (params: TypeformResponsesParams) => {
      const url = `https://api.typeform.com/forms/${safeUrlPathSegment(params.formId, 'formId')}/responses`

      const queryParams = []

      if (params.pageSize) {
        queryParams.push(`page_size=${Number(params.pageSize)}`)
      }

      if (params.before) {
        queryParams.push(`before=${encodeURIComponent(params.before)}`)
      }

      if (params.after) {
        queryParams.push(`after=${encodeURIComponent(params.after)}`)
      }

      if (params.since) {
        queryParams.push(`since=${encodeURIComponent(params.since)}`)
      }

      if (params.until) {
        queryParams.push(`until=${encodeURIComponent(params.until)}`)
      }

      const responseType = Array.isArray(params.responseType)
        ? params.responseType.join(',')
        : params.responseType
      if (responseType) {
        queryParams.push(`response_type=${encodeURIComponent(responseType)}`)
      } else if (params.completed && params.completed !== 'all') {
        queryParams.push(`completed=${params.completed}`)
      }

      return queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    total_items: {
      type: 'number',
      description: 'Total number of responses',
    },
    page_count: {
      type: 'number',
      description: 'Total number of pages available',
    },
    items: {
      type: 'array',
      description:
        'Array of response objects with response_id, submitted_at, answers, and metadata',
    },
  },
}
