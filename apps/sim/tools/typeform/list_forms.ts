import type { TypeformListFormsParams, TypeformListFormsResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const listFormsTool: ToolConfig<TypeformListFormsParams, TypeformListFormsResponse> = {
  id: 'typeform_list_forms',
  name: 'Typeform List Forms',
  description: 'Retrieve a list of all forms in your Typeform account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search query to filter forms by title',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number (default: 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of forms per page (default: 10, max: 200)',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter forms by workspace ID',
    },
  },

  request: {
    url: (params: TypeformListFormsParams) => {
      const url = 'https://api.typeform.com/forms'
      const queryParams = []

      if (params.search) {
        queryParams.push(`search=${encodeURIComponent(params.search)}`)
      }

      if (params.page) {
        queryParams.push(`page=${Number(params.page)}`)
      }

      if (params.pageSize) {
        queryParams.push(`page_size=${Number(params.pageSize)}`)
      }

      if (params.workspaceId) {
        queryParams.push(`workspace_id=${encodeURIComponent(params.workspaceId)}`)
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
      description: 'Total number of forms in the account',
    },
    page_count: {
      type: 'number',
      description: 'Total number of pages available',
    },
    items: {
      type: 'array',
      description: 'Array of form objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Form unique identifier' },
          title: { type: 'string', description: 'Form title' },
          created_at: { type: 'string', description: 'ISO timestamp of form creation' },
          last_updated_at: { type: 'string', description: 'ISO timestamp of last update' },
          settings: {
            type: 'object',
            properties: {
              is_public: { type: 'boolean', description: 'Whether form is publicly accessible' },
            },
          },
          theme: {
            type: 'object',
            properties: {
              href: { type: 'string', description: 'Theme API URL reference' },
            },
          },
          _links: {
            type: 'object',
            properties: {
              display: { type: 'string', description: 'Public form URL' },
              responses: { type: 'string', description: 'Responses API endpoint' },
            },
          },
        },
      },
    },
  },
}
