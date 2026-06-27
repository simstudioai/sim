import type { ThriveCompletionResponse, ThriveGetCompletionParams } from '@/tools/thrive/types'
import { THRIVE_COMPLETION_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getCompletionTool: ToolConfig<ThriveGetCompletionParams, ThriveCompletionResponse> = {
  id: 'thrive_get_completion',
  name: 'Thrive Get Completion',
  description: 'Get a single learning completion record in Thrive by its ID.',
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
      description: 'The completion ID',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/learning/completions/${encodeURIComponent(params.id)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveCompletionResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get completion')
    return { success: true, output: { completion: data ?? null } }
  },

  outputs: {
    completion: {
      type: 'object',
      description: 'The completion record',
      properties: THRIVE_COMPLETION_OUTPUT_PROPERTIES,
    },
  },
}
