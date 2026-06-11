import type { RampGetUserParams, RampGetUserResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetUserTool: ToolConfig<RampGetUserParams, RampGetUserResponse> = {
  id: 'ramp_get_user',
  name: 'Ramp Get User',
  description: 'Retrieve a single Ramp user by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the user to retrieve',
    },
  },

  request: {
    url: (params) => buildRampUrl(`/users/${encodeURIComponent(params.userId.trim())}`),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampGetUserResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to get Ramp user'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        user: data,
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The requested Ramp user',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the user' },
        first_name: { type: 'string', description: 'First name of the user' },
        last_name: { type: 'string', description: 'Last name of the user' },
        email: { type: 'string', description: 'Email address of the user' },
        role: { type: 'string', description: 'Role of the user in the business' },
        status: { type: 'string', description: 'Status of the user (e.g. ACTIVE)' },
        department_id: { type: 'string', description: 'ID of the user department' },
        manager_id: { type: 'string', description: 'ID of the user manager' },
      },
    },
  },
}
