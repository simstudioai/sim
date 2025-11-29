import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonSearchContacts')

export interface PylonSearchContactsParams {
  apiToken: string
  filter: string
  limit?: string
  cursor?: string
}

export interface PylonSearchContactsResponse {
  success: boolean
  output: {
    contacts: any[]
    pagination?: {
      cursor?: string
      has_next_page?: boolean
    }
    metadata: {
      operation: 'search_contacts'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonSearchContactsTool: ToolConfig<
  PylonSearchContactsParams,
  PylonSearchContactsResponse
> = {
  id: 'pylon_search_contacts',
  name: 'Search Contacts in Pylon',
  description: 'Search for contacts using a filter',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Filter as JSON object',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of contacts to return',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Pagination cursor for next page of results',
    },
  },

  request: {
    url: () => buildPylonUrl('/contacts/search'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      try {
        body.filter = JSON.parse(params.filter)
      } catch (error) {
        logger.warn('Failed to parse filter', { error })
        body.filter = {}
      }

      if (params.limit) body.limit = Number.parseInt(params.limit, 10)
      if (params.cursor) body.cursor = params.cursor

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'search_contacts')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contacts: data.data || [],
        pagination: data.pagination,
        metadata: {
          operation: 'search_contacts' as const,
          totalReturned: data.data?.length || 0,
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
        contacts: { type: 'array', description: 'Array of contact objects' },
        pagination: { type: 'object', description: 'Pagination metadata' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
