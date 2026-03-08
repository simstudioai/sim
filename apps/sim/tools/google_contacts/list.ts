import { createLogger } from '@sim/logger'
import {
  DEFAULT_PERSON_FIELDS,
  type GoogleContactsListParams,
  type GoogleContactsListResponse,
  PEOPLE_API_BASE,
  transformPerson,
} from '@/tools/google_contacts/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleContactsList')

export const listTool: ToolConfig<GoogleContactsListParams, GoogleContactsListResponse> = {
  id: 'google_contacts_list',
  name: 'Google Contacts List',
  description: 'List contacts from Google Contacts',
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
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of contacts to return (1-1000, default 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous list request for pagination',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order for contacts',
    },
  },

  request: {
    url: (params: GoogleContactsListParams) => {
      const queryParams = new URLSearchParams()
      queryParams.append('personFields', DEFAULT_PERSON_FIELDS)

      if (params.pageSize) queryParams.append('pageSize', params.pageSize.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)
      if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder)

      return `${PEOPLE_API_BASE}/people/me/connections?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params: GoogleContactsListParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to list contacts'
      logger.error('Failed to list contacts', { status: response.status, error: errorMessage })
      throw new Error(errorMessage)
    }

    const connections = data.connections || []
    const contacts = connections.map((person: Record<string, any>) => transformPerson(person))

    return {
      success: true,
      output: {
        content: `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`,
        metadata: {
          totalItems: data.totalItems ?? null,
          nextPageToken: data.nextPageToken ?? null,
          contacts,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of found contacts count' },
    metadata: {
      type: 'json',
      description: 'List of contacts with pagination tokens',
    },
  },
}
