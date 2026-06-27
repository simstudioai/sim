import type { ThriveGetUserByIdParams, ThriveUserResponse } from '@/tools/thrive/types'
import { THRIVE_USER_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getUserByIdTool: ToolConfig<ThriveGetUserByIdParams, ThriveUserResponse> = {
  id: 'thrive_get_user_by_id',
  name: 'Thrive Get User by ID',
  description: 'Get a single user in Thrive by their ID and return basic user information.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID',
    },
  },

  request: {
    url: (params) => `${getThriveBaseUrl(params.host, 'v1')}/user/${encodeURIComponent(params.id)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveUserResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get user')
    return { success: true, output: { user: data ?? null } }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The user',
      properties: THRIVE_USER_OUTPUT_PROPERTIES,
    },
  },
}
