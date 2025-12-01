import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonGetContact')

export interface PylonGetContactParams {
  apiToken: string
  contactId: string
  cursor?: string
  limit?: string
}

export interface PylonGetContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'get_contact'
      contactId: string
    }
    success: boolean
  }
}

export const pylonGetContactTool: ToolConfig<PylonGetContactParams, PylonGetContactResponse> = {
  id: 'pylon_get_contact',
  name: 'Get Contact in Pylon',
  description: 'Retrieve a specific contact by ID',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Contact ID to retrieve',
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
      description: 'Maximum number of items to return',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(buildPylonUrl(`/contacts/${params.contactId}`))
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
      handlePylonError(data, response.status, 'get_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data.data,
        metadata: {
          operation: 'get_contact' as const,
          contactId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Contact data',
      properties: {
        contact: { type: 'object', description: 'Contact object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
