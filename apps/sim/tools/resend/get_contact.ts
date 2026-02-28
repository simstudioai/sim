import { createLogger } from '@sim/logger'
import type { GetContactParams, GetContactResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendGetContactTool')

export const resendGetContactTool: ToolConfig<GetContactParams, GetContactResult> = {
  id: 'resend_get_contact',
  name: 'Get Contact',
  description: 'Retrieve details of a contact by ID or email',
  version: '1.0.0',

  params: {
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The contact ID or email address to retrieve',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: GetContactParams) =>
      `https://api.resend.com/contacts/${encodeURIComponent(params.contactId.trim())}`,
    method: 'GET',
    headers: (params: GetContactParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GetContactResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Get Contact API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to retrieve contact',
        output: {
          id: '',
          email: '',
          firstName: '',
          lastName: '',
          createdAt: '',
          unsubscribed: false,
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        email: data.email ?? '',
        firstName: data.first_name ?? '',
        lastName: data.last_name ?? '',
        createdAt: data.created_at ?? '',
        unsubscribed: data.unsubscribed ?? false,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Contact ID' },
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    createdAt: { type: 'string', description: 'Contact creation timestamp' },
    unsubscribed: { type: 'boolean', description: 'Whether the contact is unsubscribed' },
  },
}
