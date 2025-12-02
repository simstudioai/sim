import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomGetContact')

export interface IntercomGetContactParams {
  accessToken: string
  contactId: string
}

export interface IntercomGetContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'get_contact'
    }
    success: boolean
  }
}

export const intercomGetContactTool: ToolConfig<
  IntercomGetContactParams,
  IntercomGetContactResponse
> = {
  id: 'intercom_get_contact',
  name: 'Get Single Contact from Intercom',
  description: 'Get a single contact by ID from Intercom',
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
      description: 'Contact ID to retrieve',
    },
  },

  request: {
    url: (params) => buildIntercomUrl(`/contacts/${params.contactId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
        metadata: {
          operation: 'get_contact' as const,
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
