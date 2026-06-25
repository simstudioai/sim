import type { ThriveDeleteResponse, ThriveDeleteUserParams } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteUserTool: ToolConfig<ThriveDeleteUserParams, ThriveDeleteResponse> = {
  id: 'thrive_delete_user',
  name: 'Thrive Delete User',
  description:
    'Permanently delete (obfuscate) a user in Thrive by ref while retaining training history.',
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
      description: 'The user ref to delete',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v2')}/users/ref/${encodeURIComponent(params.ref)}`,
    method: 'DELETE',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveDeleteResponse> => {
    const data = await parseThriveResponse(response, 'Failed to delete user')
    return { success: true, output: { success: data?.success ?? true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the user was deleted' },
  },
}
