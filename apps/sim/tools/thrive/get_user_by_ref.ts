import type { ThriveGetUserByRefParams, ThriveUserResponse } from '@/tools/thrive/types'
import { THRIVE_BASIC_USER_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getUserByRefTool: ToolConfig<ThriveGetUserByRefParams, ThriveUserResponse> = {
  id: 'thrive_get_user_by_ref',
  name: 'Thrive Get User by Ref',
  description: 'Get a single user in Thrive by their ref and return basic user information.',
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
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ref',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/users/ref/${encodeURIComponent(params.ref)}`,
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
      description: 'The user (basic information)',
      properties: THRIVE_BASIC_USER_OUTPUT_PROPERTIES,
    },
  },
}
