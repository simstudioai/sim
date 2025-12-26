import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomGetContact')

export interface IntercomGetContactParams {
  accessToken: string
  contactId: string
}

export interface IntercomGetContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'get_contact'
    }
    success: boolean
  }
}

export const intercomGetContactTool: ToolConfig<
  IntercomGetContactParams,
  IntercomGetContactResponse
> = {
  id: 'intercom_get_contact',
  name: 'Get Single Contact from Intercom',
  description: 'Get a single contact by ID from Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID to retrieve',
    },
  },

  request: {
    url: (params) => buildIntercomUrl(`/contacts/${params.contactId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
        metadata: {
          operation: 'get_contact' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'Contact object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the contact' },
        type: { type: 'string', description: 'Object type (contact)' },
        role: { type: 'string', description: 'Role of the contact (user or lead)' },
        email: { type: 'string', description: 'Email address of the contact' },
        phone: { type: 'string', description: 'Phone number of the contact' },
        name: { type: 'string', description: 'Name of the contact' },
        avatar: { type: 'string', description: 'Avatar URL of the contact' },
        owner_id: { type: 'string', description: 'ID of the admin assigned to this contact' },
        external_id: { type: 'string', description: 'External identifier for the contact' },
        created_at: { type: 'number', description: 'Unix timestamp when contact was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when contact was last updated' },
        workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the contact' },
        tags: { type: 'object', description: 'Tags associated with the contact' },
        notes: { type: 'object', description: 'Notes associated with the contact' },
        companies: { type: 'object', description: 'Companies associated with the contact' },
        location: { type: 'object', description: 'Location information for the contact' },
        social_profiles: { type: 'object', description: 'Social profiles of the contact' },
        unsubscribed_from_emails: {
          type: 'boolean',
          description: 'Whether contact is unsubscribed from emails',
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (get_contact)' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
