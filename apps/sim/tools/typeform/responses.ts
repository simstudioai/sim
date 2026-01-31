import type { TypeformResponsesParams, TypeformResponsesResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const responsesTool: ToolConfig<TypeformResponsesParams, TypeformResponsesResponse> = {
  id: 'typeform_responses',
  name: 'Typeform Responses',
  description: 'Retrieve form responses from Typeform',
  version: '1.0.0',

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
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retrieve responses submitted after this date (e.g., "2024-01-01T00:00:00Z")',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retrieve responses submitted before this date (e.g., "2024-12-31T23:59:59Z")',
    },
    completed: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completion status (e.g., "true", "false", "all")',
    },
  },

  request: {
    url: (params: TypeformResponsesParams) => {
      const url = `https://api.typeform.com/forms/${params.formId}/responses`

      const queryParams = []

      if (params.pageSize) {
        queryParams.push(`page_size=${Number(params.pageSize)}`)
      }

      if (params.since) {
        queryParams.push(`since=${encodeURIComponent(params.since)}`)
      }

      if (params.until) {
        queryParams.push(`until=${encodeURIComponent(params.until)}`)
      }

      if (params.completed && params.completed !== 'all') {
        queryParams.push(`completed=${params.completed}`)
      }

      return queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
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
