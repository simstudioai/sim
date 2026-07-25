import {
  mapUser,
  ROCKETLANE_API_BASE,
  type RocketlaneGetUserParams,
  type RocketlaneUserResponse,
  rocketlaneError,
  rocketlaneHeaders,
  USER_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetUserTool: ToolConfig<RocketlaneGetUserParams, RocketlaneUserResponse> = {
  id: 'rocketlane_get_user',
  name: 'Rocketlane Get User',
  description: 'Retrieve a Rocketlane user by their ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the user to retrieve',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to include: role, company, permission, holidayCalendar, capacityInMinutes, profilePictureUrl',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include all fields in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/users/${encodeURIComponent(params.userId)}`)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null)
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { user: mapUser(data) },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The requested user',
      properties: USER_OUTPUT_PROPERTIES,
    },
  },
}
