import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomCreateContact')

export interface IntercomCreateContactParams {
  accessToken: string
  email?: string
  external_id?: string
  phone?: string
  name?: string
  avatar?: string
  signed_up_at?: number
  last_seen_at?: number
  owner_id?: string
  unsubscribed_from_emails?: boolean
  custom_attributes?: string
}

export interface IntercomCreateContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'create_contact'
      contactId: string
    }
    success: boolean
  }
}

export const intercomCreateContactTool: ToolConfig<
  IntercomCreateContactParams,
  IntercomCreateContactResponse
> = {
  id: 'intercom_create_contact',
  name: 'Create Contact in Intercom',
  description: 'Create a new contact in Intercom with email, external_id, or role',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "The contact's email address",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'A unique identifier for the contact provided by the client',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "The contact's phone number",
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "The contact's name",
    },
    avatar: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'An avatar image URL for the contact',
    },
    signed_up_at: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The time the user signed up as a Unix timestamp',
    },
    last_seen_at: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The time the user was last seen as a Unix timestamp',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The id of an admin that has been assigned account ownership of the contact',
    },
    unsubscribed_from_emails: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether the contact is unsubscribed from emails',
    },
    custom_attributes: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom attributes as JSON object (e.g., {"attribute_name": "value"})',
    },
  },

  request: {
    url: () => buildIntercomUrl('/contacts'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      const contact: any = {}

      if (params.email) contact.email = params.email
      if (params.external_id) contact.external_id = params.external_id
      if (params.phone) contact.phone = params.phone
      if (params.name) contact.name = params.name
      if (params.avatar) contact.avatar = params.avatar
      if (params.signed_up_at) contact.signed_up_at = params.signed_up_at
      if (params.last_seen_at) contact.last_seen_at = params.last_seen_at
      if (params.owner_id) contact.owner_id = params.owner_id
      if (params.unsubscribed_from_emails !== undefined)
        contact.unsubscribed_from_emails = params.unsubscribed_from_emails

      if (params.custom_attributes) {
        try {
          contact.custom_attributes = JSON.parse(params.custom_attributes)
        } catch (error) {
          logger.warn('Failed to parse custom attributes', { error })
        }
      }

      return contact
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
        metadata: {
          operation: 'create_contact' as const,
          contactId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created contact data',
      properties: {
        contact: { type: 'object', description: 'Created contact object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
