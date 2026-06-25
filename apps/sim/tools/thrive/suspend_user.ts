import type { ThriveSuspendUserParams, ThriveUserResponse } from '@/tools/thrive/types'
import { THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const suspendUserTool: ToolConfig<ThriveSuspendUserParams, ThriveUserResponse> = {
  id: 'thrive_suspend_user',
  name: 'Thrive Suspend User',
  description: 'Suspend a user in Thrive by ref, marking the account inactive.',
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
      description: 'The user ref to suspend',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The date this individual left your organisation (ISO 8601)',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v2')}/users/ref/${encodeURIComponent(params.ref)}/suspend`,
    method: 'PATCH',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.endDate) body.endDate = params.endDate
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveUserResponse> => {
    const data = await parseThriveResponse(response, 'Failed to suspend user')
    return { success: true, output: { user: data ?? null } }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The suspended user',
      properties: THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES,
    },
  },
}
