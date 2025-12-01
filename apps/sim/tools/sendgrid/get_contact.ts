import type { ContactResult, GetContactParams, SendGridContact } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridGetContactTool: ToolConfig<GetContactParams, ContactResult> = {
  id: 'sendgrid_get_contact',
  name: 'SendGrid Get Contact',
  description: 'Get a specific contact by ID from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID',
    },
  },

  request: {
    url: (params) => `https://api.sendgrid.com/v3/marketing/contacts/${params.contactId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ContactResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to get contact')
    }

    const data = (await response.json()) as SendGridContact

    return {
      success: true,
      output: {
        id: data.id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        listIds: data.list_ids,
        customFields: data.custom_fields,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Contact ID' },
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    listIds: { type: 'json', description: 'Array of list IDs the contact belongs to' },
    customFields: { type: 'json', description: 'Custom field values' },
  },
}
