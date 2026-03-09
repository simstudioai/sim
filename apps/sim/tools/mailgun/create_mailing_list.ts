import type { CreateMailingListParams, CreateMailingListResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunCreateMailingListTool: ToolConfig<
  CreateMailingListParams,
  CreateMailingListResult
> = {
  id: 'mailgun_create_mailing_list',
  name: 'Mailgun Create Mailing List',
  description: 'Create a new mailing list',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun API key',
    },
    address: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mailing list address (e.g., newsletter@mg.example.com)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mailing list name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mailing list description',
    },
    accessLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Access level: readonly, members, or everyone',
    },
  },

  request: {
    url: () => 'https://api.mailgun.net/v3/lists',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
    body: (params) => {
      const formData = new FormData()
      formData.append('address', params.address)

      if (params.name) {
        formData.append('name', params.name)
      }
      if (params.description) {
        formData.append('description', params.description)
      }
      if (params.accessLevel) {
        formData.append('access_level', params.accessLevel)
      }

      return { body: formData }
    },
  },

  transformResponse: async (response, params): Promise<CreateMailingListResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to create mailing list')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        message: result.message,
        list: {
          address: result.list.address,
          name: result.list.name,
          description: result.list.description,
          accessLevel: result.list.access_level,
          createdAt: result.list.created_at,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the list was created successfully' },
    message: { type: 'string', description: 'Response message' },
    list: { type: 'json', description: 'Created mailing list details' },
  },
}
