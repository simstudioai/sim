import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomListContactsParams {
  accessToken: string
  per_page?: number
  starting_after?: string
}

export interface IntercomListContactsResponse {
  success: boolean
  output: {
    contacts: any[]
    pages?: any
    metadata: {
      operation: 'list_contacts'
      total_count?: number
    }
    success: boolean
  }
}

const listContactsBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
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
      description: 'Cursor for pagination - ID to start after',
    },
  },

  request: {
    url: (params: IntercomListContactsParams) => {
      const url = buildIntercomUrl('/contacts')
      const queryParams = new URLSearchParams()

      if (params.per_page) queryParams.append('per_page', params.per_page.toString())
      if (params.starting_after) queryParams.append('starting_after', params.starting_after)

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params: IntercomListContactsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomListContactsParams, any>, 'params' | 'request'>

export const intercomListContactsTool: ToolConfig<
  IntercomListContactsParams,
  IntercomListContactsResponse
> = {
  id: 'intercom_list_contacts',
  name: 'List Contacts from Intercom',
  description: 'List all contacts from Intercom with pagination support',
  version: '1.0.0',

  ...listContactsBase,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_contacts')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contacts: data.data || [],
        pages: data.pages,
        metadata: {
          operation: 'list_contacts' as const,
          total_count: data.total_count,
        },
        success: true,
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Array of contact objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the contact' },
          type: { type: 'string', description: 'Object type (contact)' },
          role: { type: 'string', description: 'Role of the contact (user or lead)' },
          email: { type: 'string', description: 'Email address of the contact' },
          phone: { type: 'string', description: 'Phone number of the contact' },
          name: { type: 'string', description: 'Name of the contact' },
          external_id: { type: 'string', description: 'External identifier for the contact' },
          created_at: { type: 'number', description: 'Unix timestamp when contact was created' },
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when contact was last updated',
          },
          workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
          custom_attributes: {
            type: 'object',
            description: 'Custom attributes set on the contact',
          },
          tags: { type: 'object', description: 'Tags associated with the contact' },
          companies: { type: 'object', description: 'Companies associated with the contact' },
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
        operation: { type: 'string', description: 'The operation performed (list_contacts)' },
        total_count: { type: 'number', description: 'Total number of contacts' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomListContactsV2Response {
  success: boolean
  output: {
    contacts: any[]
    pages?: any
    total_count?: number
  }
}

export const intercomListContactsV2Tool: ToolConfig<
  IntercomListContactsParams,
  IntercomListContactsV2Response
> = {
  ...listContactsBase,
  id: 'intercom_list_contacts_v2',
  name: 'List Contacts from Intercom',
  description: 'List all contacts from Intercom with pagination support',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_contacts')
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
      description: 'Array of contact objects',
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
          workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
          custom_attributes: {
            type: 'object',
            description: 'Custom attributes set on the contact',
          },
          tags: { type: 'object', description: 'Tags associated with the contact', optional: true },
          companies: { type: 'object', description: 'Companies associated with the contact' },
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
    total_count: { type: 'number', description: 'Total number of contacts', optional: true },
  },
}
