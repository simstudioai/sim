import { ToolConfig, ToolResponse } from '../types'

export interface ContactsParams {
  apiKey: string
  action: 'create' | 'update' | 'search' | 'delete'
  id?: string
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  company?: string
  properties?: Record<string, any>
  limit?: number
  after?: string
  data: Record<string, any>
}

export interface ContactsResponse extends ToolResponse {
  output: {
    contacts: any[]
    totalResults?: number
    pagination?: {
      hasMore: boolean
      offset: number
    }
  }
}

export const contactsTool: ToolConfig<ContactsParams, ContactsResponse> = {
  id: 'hubspot_contacts',
  name: 'HubSpot Contacts',
  description:
    'Manage HubSpot CRM contacts with full CRUD operations support. Handle contact properties, pagination, and custom fields while maintaining data consistency across the CRM.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'HubSpot API key',
    },
    email: {
      type: 'string',
      required: true,
      description: 'Contact email address',
    },
    firstName: {
      type: 'string',
      description: 'Contact first name',
    },
    lastName: {
      type: 'string',
      description: 'Contact last name',
    },
    phone: {
      type: 'string',
      description: 'Contact phone number',
    },
    company: {
      type: 'string',
      description: 'Contact company name',
    },
    id: {
      type: 'string',
      description: 'Contact ID (required for updates)',
    },
    properties: {
      type: 'object',
      description: 'Additional contact properties',
    },
    limit: {
      type: 'number',
      default: 100,
      description: 'Number of records to return',
    },
    after: {
      type: 'string',
      description: 'Pagination cursor',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.hubapi.com/crm/v3/objects/contacts'
      if (params.id) {
        return `${baseUrl}/${params.id}`
      }
      return baseUrl
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const properties = {
        email: params.email,
        ...(params.firstName && { firstname: params.firstName }),
        ...(params.lastName && { lastname: params.lastName }),
        ...(params.phone && { phone: params.phone }),
        ...(params.company && { company: params.company }),
        ...params.properties,
      }

      if (params.id) {
        // Update existing contact
        return { properties }
      }

      // Create new contact or search
      return {
        properties,
        ...(params.limit && { limit: params.limit }),
        ...(params.after && { after: params.after }),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        contacts: data.results || [data],
        totalResults: data.total,
        pagination: data.paging,
      },
    }
  },

  transformError: (error) => {
    const message = error.message || error.error?.message
    const code = error.status || error.error?.status
    return `${message} (${code})`
  },
}
