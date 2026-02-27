import type { UpdateContactParams, UpdateContactResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

export const resendUpdateContactTool: ToolConfig<UpdateContactParams, UpdateContactResult> = {
  id: 'resend_update_contact',
  name: 'Update Contact',
  description: 'Update an existing contact in Resend',
  version: '1.0.0',

  params: {
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The contact ID or email address to update',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated last name',
    },
    unsubscribed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the contact should be unsubscribed from all broadcasts',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: UpdateContactParams) =>
      `https://api.resend.com/contacts/${encodeURIComponent(params.contactId)}`,
    method: 'PATCH',
    headers: (params: UpdateContactParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: UpdateContactParams) => ({
      ...(params.firstName !== undefined && { first_name: params.firstName }),
      ...(params.lastName !== undefined && { last_name: params.lastName }),
      ...(params.unsubscribed !== undefined && { unsubscribed: params.unsubscribed }),
    }),
  },

  transformResponse: async (response: Response): Promise<UpdateContactResult> => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Updated contact ID' },
  },
}
