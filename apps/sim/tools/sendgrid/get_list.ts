import type { GetListParams, ListResult, SendGridList } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridGetListTool: ToolConfig<GetListParams, ListResult> = {
  id: 'sendgrid_get_list',
  name: 'SendGrid Get List',
  description: 'Get a specific list by ID from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List ID',
    },
  },

  request: {
    url: (params) => `https://api.sendgrid.com/v3/marketing/lists/${params.listId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ListResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to get list')
    }

    const data = (await response.json()) as SendGridList

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        contactCount: data.contact_count,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'List ID' },
    name: { type: 'string', description: 'List name' },
    contactCount: { type: 'number', description: 'Number of contacts in the list' },
  },
}
