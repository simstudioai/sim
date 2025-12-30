import type { JotformListFormsParams, JotformListFormsResponse } from '@/tools/jotform/types'
import type { ToolConfig } from '@/tools/types'

export const listFormsTool: ToolConfig<JotformListFormsParams, JotformListFormsResponse> = {
  id: 'jotform_list_forms',
  name: 'Jotform List Forms',
  description: 'List all forms from Jotform account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API Key',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Start offset for pagination (default: 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of forms to retrieve (default: 20)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter forms (e.g., {"status:ne":"DELETED"})',
    },
    orderby: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order results by field (e.g., "created_at" or "title")',
    },
  },

  request: {
    url: (params: JotformListFormsParams) => {
      const url = 'https://api.jotform.com/user/forms'

      const queryParams = [`apiKey=${encodeURIComponent(params.apiKey)}`]

      if (params.offset) {
        queryParams.push(`offset=${Number(params.offset)}`)
      }

      if (params.limit) {
        queryParams.push(`limit=${Number(params.limit)}`)
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
        forms: data.content || [],
      },
    }
  },

  outputs: {
    forms: {
      type: 'array',
      description: 'Array of form objects with id, title, status, created_at, url, and metadata',
    },
  },
}
