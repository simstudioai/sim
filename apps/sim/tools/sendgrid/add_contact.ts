import { safeAssign } from '@/tools/safe-assign'
import type {
  AddContactParams,
  ContactResult,
  SendGridContactObject,
  SendGridContactRequest,
} from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridAddContactTool: ToolConfig<AddContactParams, ContactResult> = {
  id: 'sendgrid_add_contact',
  name: 'SendGrid Add Contact',
  description: 'Add a new contact to SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact email address',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact last name',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of custom field key-value pairs (use field IDs like e1_T, e2_N, e3_D, not field names)',
    },
    listIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list IDs to add the contact to',
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
      const contact: SendGridContactObject = {
        email: params.email,
      }

      if (params.firstName) contact.first_name = params.firstName
      if (params.lastName) contact.last_name = params.lastName

      if (params.customFields) {
        const customFields =
          typeof params.customFields === 'string'
            ? JSON.parse(params.customFields)
            : params.customFields
        safeAssign(contact, customFields as Record<string, unknown>)
      }

      const body: SendGridContactRequest = {
        contacts: [contact],
      }

      if (params.listIds) {
        body.list_ids = params.listIds.split(',').map((id) => id.trim())
      }

      return { body: JSON.stringify(body) }
    },
  },

  transformResponse: async (response, params): Promise<ContactResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.errors?.[0]?.message || 'Failed to add contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        jobId: data.job_id,
        email: params?.email || '',
        firstName: params?.firstName,
        lastName: params?.lastName,
        message:
          'Contact is being added. This is an asynchronous operation. Use the job ID to track status.',
      },
    }
  },

  outputs: {
    jobId: { type: 'string', description: 'Job ID for tracking the async contact creation' },
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    message: { type: 'string', description: 'Status message' },
  },
}
