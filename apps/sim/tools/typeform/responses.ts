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
      visibility: 'user-only',
      description: 'Typeform form ID',
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
      visibility: 'user-only',
      description: 'Number of responses to retrieve (default: 25)',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Retrieve responses submitted after this date (ISO 8601 format)',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Retrieve responses submitted before this date (ISO 8601 format)',
    },
    completed: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by completion status (true/false)',
    },
  },

  request: {
    url: (params: TypeformResponsesParams) => {
      const url = `https://api.typeform.com/forms/${params.formId}/responses`

      const queryParams = []

      if (params.pageSize) {
        queryParams.push(`page_size=${params.pageSize}`)
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
}
