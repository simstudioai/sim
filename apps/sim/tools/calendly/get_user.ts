import type { CalendlyGetUserParams, CalendlyGetUserResponse } from '@/tools/calendly/types'
import { toUuid } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<CalendlyGetUserParams, CalendlyGetUserResponse> = {
  id: 'calendly_get_user',
  name: 'Calendly Get User',
  description: 'Get information about a specific Calendly user',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    userUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User UUID. Format: UUID (e.g., "abc123-def456"), full URI (e.g., "https://api.calendly.com/users/abc123-def456"), or the constant "me" for the authenticated user',
    },
  },

  request: {
    url: (params: CalendlyGetUserParams) =>
      `https://api.calendly.com/users/${toUuid(params.userUuid)}`,
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
      description: 'User information',
      properties: {
        uri: { type: 'string', description: 'Canonical reference to the user' },
        name: { type: 'string', description: 'User full name' },
        slug: { type: 'string', description: 'Unique identifier for the user in URLs' },
        email: { type: 'string', description: 'User email address' },
        scheduling_url: { type: 'string', description: "URL to the user's scheduling page" },
        timezone: { type: 'string', description: 'User timezone' },
        time_notation: { type: 'string', description: 'Time notation preference (12h or 24h)' },
        avatar_url: { type: 'string', description: 'URL to user avatar image' },
        created_at: { type: 'string', description: 'ISO timestamp when user was created' },
        updated_at: { type: 'string', description: 'ISO timestamp when user was last updated' },
        current_organization: { type: 'string', description: 'URI of current organization' },
        resource_type: { type: 'string', description: 'Resource type' },
        locale: { type: 'string', description: 'User locale' },
      },
    },
  },
}
