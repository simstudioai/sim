import type { ListAllListsParams, ListsResult, SendGridList } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridListAllListsTool: ToolConfig<ListAllListsParams, ListsResult> = {
  id: 'sendgrid_list_all_lists',
  name: 'SendGrid List All Lists',
  description: 'Get all contact lists from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of lists to return per page (default: 100)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.sendgrid.com/v3/marketing/lists')
      if (params.pageSize) {
        url.searchParams.append('page_size', params.pageSize.toString())
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ListsResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to list all lists')
    }

    const data = (await response.json()) as { result?: SendGridList[] }

    return {
      success: true,
      output: {
        lists: data.result || [],
      },
    }
  },

  outputs: {
    lists: { type: 'json', description: 'Array of lists' },
  },
}
