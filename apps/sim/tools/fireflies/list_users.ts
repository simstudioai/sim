import type { FirefliesListUsersParams, FirefliesListUsersResponse } from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesListUsersTool: ToolConfig<
  FirefliesListUsersParams,
  FirefliesListUsersResponse
> = {
  id: 'fireflies_list_users',
  name: 'Fireflies List Users',
  description: 'List all users within your Fireflies.ai team',
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
        query Users {
          users {
            user_id
            email
            name
            num_transcripts
            recent_meeting
            minutes_consumed
            is_admin
            integrations
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
        error: data.errors[0]?.message || 'Failed to fetch users',
        output: {},
      }
    }

    const users = data.data?.users || []
    return {
      success: true,
      output: {
        users: users.map(
          (u: {
            user_id: string
            email: string
            name: string
            num_transcripts?: number
            recent_meeting?: string
            minutes_consumed?: number
            is_admin?: boolean
            integrations?: string[]
          }) => ({
            user_id: u.user_id,
            email: u.email,
            name: u.name,
            num_transcripts: u.num_transcripts,
            recent_meeting: u.recent_meeting,
            minutes_consumed: u.minutes_consumed,
            is_admin: u.is_admin,
            integrations: u.integrations,
          })
        ),
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of team users',
    },
  },
}
