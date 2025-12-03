import type { AddContactsToListParams, SendGridContactObject } from '@/tools/sendgrid/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const sendGridAddContactsToListTool: ToolConfig<AddContactsToListParams, ToolResponse> = {
  id: 'sendgrid_add_contacts_to_list',
  name: 'SendGrid Add Contacts to List',
  description:
    'Add or update contacts and assign them to a list in SendGrid (uses PUT /v3/marketing/contacts)',
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
      description: 'List ID to add contacts to',
    },
    contacts: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of contact objects. Each contact must have at least: email (or phone_number_id/external_id/anonymous_id). Example: [{"email": "user@example.com", "first_name": "John"}]',
    },
  },

  request: {
    url: () => 'https://api.sendgrid.com/v3/marketing/contacts',
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const contactsArray: SendGridContactObject[] =
        typeof params.contacts === 'string' ? JSON.parse(params.contacts) : params.contacts

      return {
        body: JSON.stringify({
          list_ids: [params.listId],
          contacts: contactsArray,
        }),
      }
    },
  },

  transformResponse: async (response): Promise<ToolResponse> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to add contacts to list')
    }

    const data = (await response.json()) as { job_id: string }

    return {
      success: true,
      output: {
        jobId: data.job_id,
        message: 'Contacts are being added to the list. This is an asynchronous operation.',
      },
    }
  },

  outputs: {
    jobId: { type: 'string', description: 'Job ID for tracking the async operation' },
    message: { type: 'string', description: 'Status message' },
  },
}
