import type { ListContactsParams, ListContactsResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

export const resendListContactsTool: ToolConfig<ListContactsParams, ListContactsResult> = {
  id: 'resend_list_contacts',
  name: 'List Contacts',
  description: 'List all contacts in Resend',
  version: '1.0.0',

  params: {
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: 'https://api.resend.com/contacts',
    method: 'GET',
    headers: (params: ListContactsParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<ListContactsResult> => {
    const data = await response.json()

    return {
      success: true,
      output: {
        contacts: data.data || [],
        hasMore: data.has_more || false,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'json',
      description:
        'Array of contacts with id, email, first_name, last_name, created_at, unsubscribed',
    },
    hasMore: { type: 'boolean', description: 'Whether there are more contacts to retrieve' },
  },
}
