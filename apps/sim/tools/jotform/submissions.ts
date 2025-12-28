import type { JotformSubmissionsParams, JotformSubmissionsResponse } from '@/tools/jotform/types'
import type { ToolConfig } from '@/tools/types'

export const submissionsTool: ToolConfig<
  JotformSubmissionsParams,
  JotformSubmissionsResponse
> = {
  id: 'jotform_submissions',
  name: 'Jotform Submissions',
  description: 'Retrieve form submissions from Jotform',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API Key',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform form ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of submissions to retrieve (default: 20, max: 1000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Start offset for pagination (default: 0)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter submissions (e.g., {"status:ne":"DELETED"})',
    },
    orderby: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order results by field (e.g., "created_at" or "id")',
    },
  },

  request: {
    url: (params: JotformSubmissionsParams) => {
      const url = `https://api.jotform.com/form/${params.formId}/submissions`

      const queryParams = [`apiKey=${encodeURIComponent(params.apiKey)}`]

      if (params.limit) {
        queryParams.push(`limit=${Number(params.limit)}`)
      }

      if (params.offset) {
        queryParams.push(`offset=${Number(params.offset)}`)
      }

      if (params.filter) {
        queryParams.push(`filter=${encodeURIComponent(params.filter)}`)
      }

      if (params.orderby) {
        queryParams.push(`orderby=${encodeURIComponent(params.orderby)}`)
      }

      return `${url}?${queryParams.join('&')}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        resultSet: data.content || [],
      },
    }
  },

  outputs: {
    resultSet: {
      type: 'array',
      description:
        'Array of submission objects with id, form_id, created_at, status, answers, and metadata',
    },
  },
}
