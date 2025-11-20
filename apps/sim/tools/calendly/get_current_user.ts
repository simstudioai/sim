import type {
  CalendlyGetCurrentUserParams,
  CalendlyGetCurrentUserResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const getCurrentUserTool: ToolConfig<
  CalendlyGetCurrentUserParams,
  CalendlyGetCurrentUserResponse
> = {
  id: 'calendly_get_current_user',
  name: 'Calendly Get Current User',
  description: 'Get information about the currently authenticated Calendly user',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
  },

  request: {
    url: () => 'https://api.calendly.com/users/me',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    resource: {
      type: 'object',
      description: 'Current user information',
      properties: {
        uri: {
          type: 'string',
          description: 'Canonical reference to the user',
        },
        name: {
          type: 'string',
          description: 'User full name',
        },
        slug: {
          type: 'string',
          description: 'Unique identifier for the user in URLs',
        },
        email: {
          type: 'string',
          description: 'User email address',
        },
        scheduling_url: {
          type: 'string',
          description: "URL to the user's scheduling page",
        },
        timezone: {
          type: 'string',
          description: 'User timezone',
        },
        avatar_url: {
          type: 'string',
          description: 'URL to user avatar image',
        },
        created_at: {
          type: 'string',
          description: 'ISO timestamp when user was created',
        },
        updated_at: {
          type: 'string',
          description: 'ISO timestamp when user was last updated',
        },
        current_organization: {
          type: 'string',
          description: 'URI of current organization',
        },
      },
    },
  },
}
