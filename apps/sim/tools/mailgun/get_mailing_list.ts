import type { GetMailingListParams, GetMailingListResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunGetMailingListTool: ToolConfig<GetMailingListParams, GetMailingListResult> = {
  id: 'mailgun_get_mailing_list',
  name: 'Mailgun Get Mailing List',
  description: 'Get details of a mailing list',
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
      description: 'Mailing list address to retrieve (e.g., newsletter@mg.example.com)',
    },
  },

  request: {
    url: (params) => `https://api.mailgun.net/v3/lists/${params.address}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
  },

  transformResponse: async (response, params): Promise<GetMailingListResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to get mailing list')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        list: {
          address: result.list.address,
          name: result.list.name,
          description: result.list.description,
          accessLevel: result.list.access_level,
          membersCount: result.list.members_count,
          createdAt: result.list.created_at,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the request was successful' },
    list: { type: 'json', description: 'Mailing list details' },
  },
}
