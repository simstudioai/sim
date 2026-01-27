import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('IntercomCreateContact')

export interface IntercomCreateContactParams {
  accessToken: string
  role?: 'user' | 'lead'
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
  company_id?: string
}

export interface IntercomCreateContactResponse {
  success: boolean
  output: {
    contact: {
      id: string
      type: string
      role: string
      email: string | null
      phone: string | null
      name: string | null
      avatar: string | null
      owner_id: string | null
      external_id: string | null
      created_at: number
      updated_at: number
      signed_up_at: number | null
      last_seen_at: number | null
      workspace_id: string
      custom_attributes: Record<string, any>
      tags: {
        type: string
        url: string
        data: any[]
        has_more: boolean
        total_count: number
      }
      notes: {
        type: string
        url: string
        data: any[]
        has_more: boolean
        total_count: number
      }
      companies: {
        type: string
        url: string
        data: any[]
        has_more: boolean
        total_count: number
      }
      location: {
        type: string
        city: string | null
        region: string | null
        country: string | null
        country_code: string | null
        continent_code: string | null
      }
      social_profiles: {
        type: string
        data: any[]
      }
      unsubscribed_from_emails: boolean
      [key: string]: any
    }
    metadata: {
      operation: 'create_contact'
      contactId: string
    }
    success: boolean
  }
}

const intercomCreateContactBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The role of the contact. Accepts 'user' or 'lead'. Defaults to 'lead' if not specified.",
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The contact's email address",
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A unique identifier for the contact provided by the client',
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
      description: 'Company ID to associate the contact with during creation',
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

      if (params.role) contact.role = params.role
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

      if (params.company_id) contact.company_id = params.company_id

      return contact
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateContactParams, any>, 'params' | 'request'>

export const intercomCreateContactTool: ToolConfig<
  IntercomCreateContactParams,
  IntercomCreateContactResponse
> = {
  id: 'intercom_create_contact',
  name: 'Create Contact in Intercom',
  description: 'Create a new contact in Intercom with email, external_id, or role',
  version: '1.0.0',

  ...intercomCreateContactBase,

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
    contact: {
      type: 'object',
      description: 'Created contact object',
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
        signed_up_at: { type: 'number', description: 'Unix timestamp when user signed up' },
        last_seen_at: { type: 'number', description: 'Unix timestamp when user was last seen' },
        workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the contact' },
        tags: {
          type: 'object',
          description: 'Tags associated with the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            url: { type: 'string', description: 'URL to fetch tags' },
            data: { type: 'array', description: 'Array of tag objects' },
            has_more: { type: 'boolean', description: 'Whether there are more tags' },
            total_count: { type: 'number', description: 'Total number of tags' },
          },
        },
        notes: {
          type: 'object',
          description: 'Notes associated with the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            url: { type: 'string', description: 'URL to fetch notes' },
            data: { type: 'array', description: 'Array of note objects' },
            has_more: { type: 'boolean', description: 'Whether there are more notes' },
            total_count: { type: 'number', description: 'Total number of notes' },
          },
        },
        companies: {
          type: 'object',
          description: 'Companies associated with the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            url: { type: 'string', description: 'URL to fetch companies' },
            data: { type: 'array', description: 'Array of company objects' },
            has_more: { type: 'boolean', description: 'Whether there are more companies' },
            total_count: { type: 'number', description: 'Total number of companies' },
          },
        },
        location: {
          type: 'object',
          description: 'Location information for the contact',
          properties: {
            type: { type: 'string', description: 'Location type' },
            city: { type: 'string', description: 'City' },
            region: { type: 'string', description: 'Region/State' },
            country: { type: 'string', description: 'Country' },
            country_code: { type: 'string', description: 'Country code' },
            continent_code: { type: 'string', description: 'Continent code' },
          },
        },
        social_profiles: {
          type: 'object',
          description: 'Social profiles of the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            data: { type: 'array', description: 'Array of social profile objects' },
          },
        },
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
        operation: { type: 'string', description: 'The operation performed (create_contact)' },
        contactId: { type: 'string', description: 'ID of the created contact' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomCreateContactV2Response {
  success: boolean
  output: {
    contact: IntercomCreateContactResponse['output']['contact']
    contactId: string
  }
}

export const intercomCreateContactV2Tool: ToolConfig<
  IntercomCreateContactParams,
  IntercomCreateContactV2Response
> = {
  ...intercomCreateContactBase,
  id: 'intercom_create_contact_v2',
  name: 'Create Contact in Intercom',
  description:
    'Create a new contact in Intercom with email, external_id, or role. Returns API-aligned fields only.',
  version: '2.0.0',

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
        contactId: data.id,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'Created contact object',
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
        signed_up_at: { type: 'number', description: 'Unix timestamp when user signed up' },
        last_seen_at: { type: 'number', description: 'Unix timestamp when user was last seen' },
        workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
        custom_attributes: { type: 'object', description: 'Custom attributes set on the contact' },
        tags: {
          type: 'object',
          description: 'Tags associated with the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            url: { type: 'string', description: 'URL to fetch tags' },
            data: { type: 'array', description: 'Array of tag objects' },
            has_more: { type: 'boolean', description: 'Whether there are more tags' },
            total_count: { type: 'number', description: 'Total number of tags' },
          },
        },
        notes: {
          type: 'object',
          description: 'Notes associated with the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            url: { type: 'string', description: 'URL to fetch notes' },
            data: { type: 'array', description: 'Array of note objects' },
            has_more: { type: 'boolean', description: 'Whether there are more notes' },
            total_count: { type: 'number', description: 'Total number of notes' },
          },
        },
        companies: {
          type: 'object',
          description: 'Companies associated with the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            url: { type: 'string', description: 'URL to fetch companies' },
            data: { type: 'array', description: 'Array of company objects' },
            has_more: { type: 'boolean', description: 'Whether there are more companies' },
            total_count: { type: 'number', description: 'Total number of companies' },
          },
        },
        location: {
          type: 'object',
          description: 'Location information for the contact',
          properties: {
            type: { type: 'string', description: 'Location type' },
            city: { type: 'string', description: 'City' },
            region: { type: 'string', description: 'Region/State' },
            country: { type: 'string', description: 'Country' },
            country_code: { type: 'string', description: 'Country code' },
            continent_code: { type: 'string', description: 'Continent code' },
          },
        },
        social_profiles: {
          type: 'object',
          description: 'Social profiles of the contact',
          properties: {
            type: { type: 'string', description: 'List type' },
            data: { type: 'array', description: 'Array of social profile objects' },
          },
        },
        unsubscribed_from_emails: {
          type: 'boolean',
          description: 'Whether contact is unsubscribed from emails',
        },
      },
    },
    contactId: { type: 'string', description: 'ID of the created contact' },
  },
}
