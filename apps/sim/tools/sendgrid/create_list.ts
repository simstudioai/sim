import type { CreateListParams, ListResult, SendGridList } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridCreateListTool: ToolConfig<CreateListParams, ListResult> = {
  id: 'sendgrid_create_list',
  name: 'SendGrid Create List',
  description: 'Create a new contact list in SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List name',
    },
  },

  request: {
    url: () => 'https://api.sendgrid.com/v3/marketing/lists',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        body: JSON.stringify({
          name: params.name,
        }),
      }
    },
  },

  transformResponse: async (response): Promise<ListResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to create list')
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
