import { createLogger } from '@sim/logger'
import {
  type GoogleContactsDeleteParams,
  type GoogleContactsDeleteResponse,
  PEOPLE_API_BASE,
} from '@/tools/google_contacts/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleContactsDelete')

export const deleteTool: ToolConfig<GoogleContactsDeleteParams, GoogleContactsDeleteResponse> = {
  id: 'google_contacts_delete',
  name: 'Google Contacts Delete',
  description: 'Delete a contact from Google Contacts',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-contacts',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Google People API',
    },
    resourceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Resource name of the contact to delete (e.g., people/c1234567890)',
    },
  },

  request: {
    url: (params: GoogleContactsDeleteParams) =>
      `${PEOPLE_API_BASE}/${params.resourceName.trim()}:deleteContact`,
    method: 'DELETE',
    headers: (params: GoogleContactsDeleteParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 200 || response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          content: 'Contact successfully deleted',
          metadata: {
            resourceName: params?.resourceName || '',
            deleted: true,
          },
        },
      }
    }

    const errorData = await response.json()
    const errorMessage = errorData.error?.message || 'Failed to delete contact'
    logger.error('Failed to delete contact', { status: response.status, error: errorMessage })
    throw new Error(errorMessage)
  },

  outputs: {
    content: { type: 'string', description: 'Contact deletion confirmation message' },
    metadata: {
      type: 'json',
      description: 'Deletion details including resource name',
    },
  },
}
