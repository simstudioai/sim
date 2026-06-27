import type { ThriveDeleteResponse, ThriveRemoveAudienceMemberParams } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const removeAudienceMemberTool: ToolConfig<
  ThriveRemoveAudienceMemberParams,
  ThriveDeleteResponse
> = {
  id: 'thrive_remove_audience_member',
  name: 'Thrive Remove Audience Member',
  description: 'Remove a single member from a Thrive audience.',
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
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The audience id or audience reference',
    },
    userRef: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user email, ref, or id to remove',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/audiences/${encodeURIComponent(params.audienceId)}/members/${encodeURIComponent(params.userRef)}`,
    method: 'DELETE',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveDeleteResponse> => {
    const data = await parseThriveResponse(response, 'Failed to remove audience member')
    return { success: true, output: { success: data?.success ?? true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the audience member was removed' },
  },
}
