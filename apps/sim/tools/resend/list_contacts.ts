import { createLogger } from '@sim/logger'
import type { ListContactsParams, ListContactsResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendListContactsTool')

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

    if (data.message) {
      logger.error('Resend List Contacts API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to list contacts',
        output: {
          contacts: [],
          hasMore: false,
        },
      }
    }

    return {
      success: true,
      output: {
        contacts: data.data ?? [],
        hasMore: data.has_more ?? false,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Array of contacts',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Contact ID' },
          email: { type: 'string', description: 'Contact email address' },
          first_name: { type: 'string', description: 'Contact first name' },
          last_name: { type: 'string', description: 'Contact last name' },
          created_at: { type: 'string', description: 'Contact creation timestamp' },
          unsubscribed: { type: 'boolean', description: 'Whether the contact is unsubscribed' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether there are more contacts to retrieve' },
  },
}
