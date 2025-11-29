import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListContacts')

export interface PylonListContactsParams {
  apiToken: string
  cursor?: string
  limit?: string
}

export interface PylonListContactsResponse {
  success: boolean
  output: {
    contacts: any[]
    pagination?: {
      cursor?: string
      has_next_page?: boolean
    }
    metadata: {
      operation: 'list_contacts'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonListContactsTool: ToolConfig<PylonListContactsParams, PylonListContactsResponse> =
  {
    id: 'pylon_list_contacts',
    name: 'List Contacts in Pylon',
    description: 'Retrieve a list of contacts',
    version: '1.0.0',

    params: {
      apiToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Pylon API token',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Pagination cursor for next page of results',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Maximum number of contacts to return',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(buildPylonUrl('/contacts'))
        if (params.cursor) {
          url.searchParams.append('cursor', params.cursor)
        }
        if (params.limit) {
          url.searchParams.append('limit', params.limit)
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiToken}`,
      }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const data = await response.json()
        handlePylonError(data, response.status, 'list_contacts')
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          contacts: data.data || [],
          pagination: data.pagination,
          metadata: {
            operation: 'list_contacts' as const,
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
        description: 'List of contacts',
        properties: {
          contacts: { type: 'array', description: 'Array of contact objects' },
          pagination: { type: 'object', description: 'Pagination metadata' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
