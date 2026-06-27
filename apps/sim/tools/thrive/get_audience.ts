import type { ThriveAudienceResponse, ThriveGetAudienceParams } from '@/tools/thrive/types'
import { THRIVE_AUDIENCE_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getAudienceTool: ToolConfig<ThriveGetAudienceParams, ThriveAudienceResponse> = {
  id: 'thrive_get_audience',
  name: 'Thrive Get Audience',
  description: 'Get a single audience or structure in Thrive by id or reference.',
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
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/audiences/${encodeURIComponent(params.audienceId)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveAudienceResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get audience')
    return { success: true, output: { audience: data ?? null } }
  },

  outputs: {
    audience: {
      type: 'object',
      description: 'The audience',
      properties: THRIVE_AUDIENCE_OUTPUT_PROPERTIES,
    },
  },
}
