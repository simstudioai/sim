import type {
  FirefliesListContactsParams,
  FirefliesListContactsResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesListContactsTool: ToolConfig<
  FirefliesListContactsParams,
  FirefliesListContactsResponse
> = {
  id: 'fireflies_list_contacts',
  name: 'Fireflies List Contacts',
  description: 'List all contacts from your Fireflies.ai meetings',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
  },

  request: {
    url: 'https://api.fireflies.ai/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Fireflies API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
    body: () => ({
      query: `
        query Contacts {
          contacts {
            email
            name
            picture
            last_meeting_date
          }
        }
      `,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch contacts',
        output: {},
      }
    }

    const contacts = data.data?.contacts || []
    return {
      success: true,
      output: {
        contacts: contacts.map(
          (c: { email?: string; name?: string; picture?: string; last_meeting_date?: string }) => ({
            email: c.email,
            name: c.name,
            picture: c.picture,
            last_meeting_date: c.last_meeting_date,
          })
        ),
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'List of contacts from meetings',
    },
  },
}
