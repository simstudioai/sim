import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('IntercomUpdateContact')

export interface IntercomUpdateContactParams {
  accessToken: string
  contactId: string
  role?: 'user' | 'lead'
  external_id?: string
  email?: string
  phone?: string
  name?: string
  avatar?: string
  signed_up_at?: number
  last_seen_at?: number
  owner_id?: string
  unsubscribed_from_emails?: boolean
  custom_attributes?: string
  company_id?: string
}

export interface IntercomUpdateContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'update_contact'
      contactId: string
    }
    success: boolean
  }
}

const intercomUpdateContactBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID to update',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The role of the contact. Accepts 'user' or 'lead'.",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A unique identifier for the contact provided by the client',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The contact's email address",
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The contact's phone number",
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The contact's name",
    },
    avatar: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An avatar image URL for the contact',
    },
    signed_up_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The time the user signed up as a Unix timestamp',
    },
    last_seen_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The time the user was last seen as a Unix timestamp',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The id of an admin that has been assigned account ownership of the contact',
    },
    unsubscribed_from_emails: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the contact is unsubscribed from emails',
    },
    custom_attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom attributes as JSON object (e.g., {"attribute_name": "value"})',
    },
    company_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company ID to associate the contact with',
    },
  },

  request: {
    url: (params) => buildIntercomUrl(`/contacts/${params.contactId}`),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      const contact: any = {}

      if (params.role) contact.role = params.role
      if (params.external_id) contact.external_id = params.external_id
      if (params.email) contact.email = params.email
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

      if (params.company_id) contact.company_id = params.company_id

      return contact
    },
  },
} satisfies Pick<ToolConfig<IntercomUpdateContactParams, any>, 'params' | 'request'>

export const intercomUpdateContactTool: ToolConfig<
  IntercomUpdateContactParams,
  IntercomUpdateContactResponse
> = {
  id: 'intercom_update_contact',
  name: 'Update Contact in Intercom',
  description: 'Update an existing contact in Intercom',
  version: '1.0.0',

  ...intercomUpdateContactBase,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'update_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
        metadata: {
          operation: 'update_contact' as const,
          contactId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'Updated contact object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the contact' },
        type: { type: 'string', description: 'Object type (contact)' },
        role: { type: 'string', description: 'Role of the contact (user or lead)' },
        email: { type: 'string', description: 'Email address of the contact', optional: true },
        phone: { type: 'string', description: 'Phone number of the contact', optional: true },
        name: { type: 'string', description: 'Name of the contact', optional: true },
        avatar: { type: 'string', description: 'Avatar URL of the contact', optional: true },
        owner_id: {
          type: 'string',
          description: 'ID of the admin assigned to this contact',
          optional: true,
        },
        external_id: {
          type: 'string',
          description: 'External identifier for the contact',
          optional: true,
        },
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
        operation: { type: 'string', description: 'The operation performed (update_contact)' },
        contactId: { type: 'string', description: 'ID of the updated contact' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomUpdateContactV2Response {
  success: boolean
  output: {
    contact: any
    contactId: string
  }
}

export const intercomUpdateContactV2Tool: ToolConfig<
  IntercomUpdateContactParams,
  IntercomUpdateContactV2Response
> = {
  ...intercomUpdateContactBase,
  id: 'intercom_update_contact_v2',
  name: 'Update Contact in Intercom',
  description: 'Update an existing contact in Intercom. Returns API-aligned fields only.',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'update_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
        contactId: data.id,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'Updated contact object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the contact' },
        type: { type: 'string', description: 'Object type (contact)' },
        role: { type: 'string', description: 'Role of the contact (user or lead)' },
        email: { type: 'string', description: 'Email address of the contact', optional: true },
        phone: { type: 'string', description: 'Phone number of the contact', optional: true },
        name: { type: 'string', description: 'Name of the contact', optional: true },
        avatar: { type: 'string', description: 'Avatar URL of the contact', optional: true },
        owner_id: {
          type: 'string',
          description: 'ID of the admin assigned to this contact',
          optional: true,
        },
        external_id: {
          type: 'string',
          description: 'External identifier for the contact',
          optional: true,
        },
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
    contactId: { type: 'string', description: 'ID of the updated contact' },
  },
}
