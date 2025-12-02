import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomDeleteContact')

export interface IntercomDeleteContactParams {
  accessToken: string
  contactId: string
}

export interface IntercomDeleteContactResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_contact'
    }
    success: boolean
  }
}

export const intercomDeleteContactTool: ToolConfig<
  IntercomDeleteContactParams,
  IntercomDeleteContactResponse
> = {
  id: 'intercom_delete_contact',
  name: 'Delete Contact from Intercom',
  description: 'Delete a contact from Intercom by ID',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Contact ID to delete',
    },
  },

  request: {
    url: (params) => buildIntercomUrl(`/contacts/${params.contactId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'delete_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        deleted: true,
        metadata: {
          operation: 'delete_contact' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion result',
      properties: {
        id: { type: 'string', description: 'ID of deleted contact' },
        deleted: { type: 'boolean', description: 'Deletion status' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
