import type { LinearGetViewerParams, LinearGetViewerResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearGetViewerTool: ToolConfig<LinearGetViewerParams, LinearGetViewerResponse> = {
  id: 'linear_get_viewer',
  name: 'Linear Get Current User',
  description: 'Get the currently authenticated user (viewer) information',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {},

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: () => ({
      query: `
        query GetViewer {
          viewer {
            id
            name
            email
            displayName
            active
            admin
            avatarUrl
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
        error: data.errors[0]?.message || 'Failed to get viewer',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        user: data.data.viewer,
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The currently authenticated user',
      properties: {
        id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'User name' },
        email: { type: 'string', description: 'User email' },
        displayName: { type: 'string', description: 'Display name' },
        active: { type: 'boolean', description: 'Whether user is active' },
        admin: { type: 'boolean', description: 'Whether user is admin' },
        avatarUrl: { type: 'string', description: 'Avatar URL' },
      },
    },
  },
}
