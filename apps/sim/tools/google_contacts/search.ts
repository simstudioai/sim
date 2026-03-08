import { createLogger } from '@sim/logger'
import {
  DEFAULT_PERSON_FIELDS,
  type GoogleContactsSearchParams,
  type GoogleContactsSearchResponse,
  PEOPLE_API_BASE,
  transformPerson,
} from '@/tools/google_contacts/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleContactsSearch')

export const searchTool: ToolConfig<GoogleContactsSearchParams, GoogleContactsSearchResponse> = {
  id: 'google_contacts_search',
  name: 'Google Contacts Search',
  description: 'Search contacts in Google Contacts by name, email, phone, or organization',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to match against contact names, emails, phones, and organizations',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 30)',
    },
  },

  request: {
    url: (params: GoogleContactsSearchParams) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)
      queryParams.append('readMask', DEFAULT_PERSON_FIELDS)

      if (params.pageSize) queryParams.append('pageSize', params.pageSize.toString())

      return `${PEOPLE_API_BASE}/people:searchContacts?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params: GoogleContactsSearchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to search contacts'
      logger.error('Failed to search contacts', { status: response.status, error: errorMessage })
      throw new Error(errorMessage)
    }

    const results = data.results || []
    const contacts = results.map((result: Record<string, any>) =>
      transformPerson(result.person || result)
    )

    return {
      success: true,
      output: {
        content: `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''} matching query`,
        metadata: {
          contacts,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Summary of search results count' },
    metadata: {
      type: 'json',
      description: 'Search results with matching contacts',
    },
  },
}
