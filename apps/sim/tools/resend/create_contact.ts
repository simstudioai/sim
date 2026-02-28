import { createLogger } from '@sim/logger'
import type { CreateContactParams, CreateContactResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendCreateContactTool')

export const resendCreateContactTool: ToolConfig<CreateContactParams, CreateContactResult> = {
  id: 'resend_create_contact',
  name: 'Create Contact',
  description: 'Create a new contact in Resend',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the contact',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    unsubscribed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the contact is unsubscribed from all broadcasts',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: 'https://api.resend.com/contacts',
    method: 'POST',
    headers: (params: CreateContactParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CreateContactParams) => ({
      email: params.email,
      ...(params.firstName && { first_name: params.firstName }),
      ...(params.lastName && { last_name: params.lastName }),
      ...(params.unsubscribed !== undefined && { unsubscribed: params.unsubscribed }),
    }),
  },

  transformResponse: async (response: Response): Promise<CreateContactResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Create Contact API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to create contact',
        output: {
          id: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created contact ID' },
  },
}
