import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomSearchContacts')

export interface IntercomSearchContactsParams {
  accessToken: string
  query: string
  per_page?: number
  starting_after?: string
}

export interface IntercomSearchContactsResponse {
  success: boolean
  output: {
    contacts: any[]
    pages?: any
    metadata: {
      operation: 'search_contacts'
      total_count?: number
    }
    success: boolean
  }
}

export const intercomSearchContactsTool: ToolConfig<
  IntercomSearchContactsParams,
  IntercomSearchContactsResponse
> = {
  id: 'intercom_search_contacts',
  name: 'Search Contacts in Intercom',
  description: 'Search for contacts in Intercom using a query',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Search query (e.g., {"field":"email","operator":"=","value":"user@example.com"})',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (max: 150)',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Cursor for pagination',
    },
  },

  request: {
    url: () => buildIntercomUrl('/contacts/search'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
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

      return body
    },
  },

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
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Search results',
      properties: {
        contacts: { type: 'array', description: 'Array of matching contact objects' },
        pages: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
