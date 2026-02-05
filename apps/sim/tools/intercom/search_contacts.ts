import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomSearchContactsParams {
  accessToken: string
  query: string
  per_page?: number
  starting_after?: string
  sort_field?: string
  sort_order?: 'ascending' | 'descending'
}

export interface IntercomSearchContactsResponse {
  success: boolean
  output: {
    contacts: Array<{
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
    }>
    pages: {
      type: string
      page: number
      per_page: number
      total_pages: number
    }
    metadata: {
      operation: 'search_contacts'
      total_count: number
    }
    success: boolean
  }
}

const searchContactsBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query (e.g., {"field":"email","operator":"=","value":"user@example.com"})',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max: 150)',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
    sort_field: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by (e.g., "name", "created_at", "last_seen_at")',
    },
    sort_order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "ascending" or "descending"',
    },
  },

  request: {
    url: () => buildIntercomUrl('/contacts/search'),
    method: 'POST',
    headers: (params: IntercomSearchContactsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomSearchContactsParams) => {
      let query
      try {
        query = JSON.parse(params.query)
      } catch (error) {
        // If not JSON, treat as simple text search
        query = {
          field: 'name',
          operator: '~',
          value: params.query,
        }
      }

      const body: any = { query }

      if (params.per_page) body.pagination = { per_page: params.per_page }
      if (params.starting_after)
        body.pagination = { ...body.pagination, starting_after: params.starting_after }

      if (params.sort_field) {
        body.sort = {
          field: params.sort_field,
          order: params.sort_order || 'descending',
        }
      }

      return body
    },
  },
} satisfies Pick<ToolConfig<IntercomSearchContactsParams, any>, 'params' | 'request'>

export const intercomSearchContactsTool: ToolConfig<
  IntercomSearchContactsParams,
  IntercomSearchContactsResponse
> = {
  id: 'intercom_search_contacts',
  name: 'Search Contacts in Intercom',
  description: 'Search for contacts in Intercom using a query',
  version: '1.0.0',

  ...searchContactsBase,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'search_contacts')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contacts: data.data || [],
        pages: data.pages,
        metadata: {
          operation: 'search_contacts' as const,
          total_count: data.total_count,
        },
        success: true,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Array of matching contact objects',
      items: {
        type: 'object',
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
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when contact was last updated',
          },
          signed_up_at: { type: 'number', description: 'Unix timestamp when user signed up' },
          last_seen_at: { type: 'number', description: 'Unix timestamp when user was last seen' },
          workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
          custom_attributes: {
            type: 'object',
            description: 'Custom attributes set on the contact',
          },
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
    },
    pages: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        type: { type: 'string', description: 'Pages type identifier' },
        page: { type: 'number', description: 'Current page number' },
        per_page: { type: 'number', description: 'Number of results per page' },
        total_pages: { type: 'number', description: 'Total number of pages' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (search_contacts)' },
        total_count: { type: 'number', description: 'Total number of matching contacts' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomSearchContactsV2Response {
  success: boolean
  output: {
    contacts: Array<{
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
    }>
    pages: {
      type: string
      page: number
      per_page: number
      total_pages: number
    }
    total_count: number
  }
}

export const intercomSearchContactsV2Tool: ToolConfig<
  IntercomSearchContactsParams,
  IntercomSearchContactsV2Response
> = {
  ...searchContactsBase,
  id: 'intercom_search_contacts_v2',
  name: 'Search Contacts in Intercom',
  description: 'Search for contacts in Intercom using a query',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'search_contacts')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contacts: data.data ?? null,
        pages: data.pages ?? null,
        total_count: data.total_count ?? null,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Array of matching contact objects',
      optional: true,
      items: {
        type: 'object',
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
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when contact was last updated',
          },
          signed_up_at: {
            type: 'number',
            description: 'Unix timestamp when user signed up',
            optional: true,
          },
          last_seen_at: {
            type: 'number',
            description: 'Unix timestamp when user was last seen',
            optional: true,
          },
          workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
          custom_attributes: {
            type: 'object',
            description: 'Custom attributes set on the contact',
          },
          tags: { type: 'object', description: 'Tags associated with the contact', optional: true },
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
    },
    pages: {
      type: 'object',
      description: 'Pagination information',
      optional: true,
      properties: {
        type: { type: 'string', description: 'Pages type identifier' },
        page: { type: 'number', description: 'Current page number' },
        per_page: { type: 'number', description: 'Number of results per page' },
        total_pages: { type: 'number', description: 'Total number of pages' },
      },
    },
    total_count: {
      type: 'number',
      description: 'Total number of matching contacts',
      optional: true,
    },
  },
}
