import type { FirefliesGetUserParams, FirefliesGetUserResponse } from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesGetUserTool: ToolConfig<FirefliesGetUserParams, FirefliesGetUserResponse> = {
  id: 'fireflies_get_user',
  name: 'Fireflies Get User',
  description: 'Get user information from Fireflies.ai. Returns current user if no ID specified.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to retrieve (e.g., "user_abc123", defaults to API key owner)',
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
    body: (params) => ({
      query: `
        query User($id: String) {
          user(id: $id) {
            user_id
            name
            email
            integrations
            is_admin
            minutes_consumed
            num_transcripts
            recent_transcript
            recent_meeting
          }
        }
      `,
      variables: params.userId ? { id: params.userId } : {},
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch user',
        output: {},
      }
    }

    const user = data.data?.user
    if (!user) {
      return {
        success: false,
        error: 'User not found',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        user: {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
          integrations: user.integrations,
          is_admin: user.is_admin,
          minutes_consumed: user.minutes_consumed,
          num_transcripts: user.num_transcripts,
          recent_transcript: user.recent_transcript,
          recent_meeting: user.recent_meeting,
        },
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'User information',
      properties: {
        user_id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'User name' },
        email: { type: 'string', description: 'User email' },
        integrations: { type: 'array', description: 'Connected integrations' },
        is_admin: { type: 'boolean', description: 'Whether user is admin' },
        minutes_consumed: { type: 'number', description: 'Total minutes transcribed' },
        num_transcripts: { type: 'number', description: 'Number of transcripts' },
        recent_transcript: { type: 'string', description: 'Most recent transcript ID' },
        recent_meeting: { type: 'string', description: 'Most recent meeting date' },
      },
    },
  },
}
