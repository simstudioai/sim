import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonDeleteContact')

export interface PylonDeleteContactParams {
  apiToken: string
  contactId: string
}

export interface PylonDeleteContactResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_contact'
      contactId: string
    }
    success: boolean
  }
}

export const pylonDeleteContactTool: ToolConfig<
  PylonDeleteContactParams,
  PylonDeleteContactResponse
> = {
  id: 'pylon_delete_contact',
  name: 'Delete Contact in Pylon',
  description: 'Delete a specific contact by ID',
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
      description: 'Contact ID to delete',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/contacts/${params.contactId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'delete_contact')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_contact' as const,
          contactId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Delete operation result',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
