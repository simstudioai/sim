import type { ThriveActivityResponse, ThriveGetActivityParams } from '@/tools/thrive/types'
import { THRIVE_ACTIVITY_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getActivityTool: ToolConfig<ThriveGetActivityParams, ThriveActivityResponse> = {
  id: 'thrive_get_activity',
  name: 'Thrive Get Activity',
  description: 'Get a single activity record in Thrive by its ID.',
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
      description: 'Unique identifier of the activity',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/activity/${encodeURIComponent(params.id)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveActivityResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get activity')
    return { success: true, output: { activity: data ?? null } }
  },

  outputs: {
    activity: {
      type: 'object',
      description: 'The activity record',
      properties: THRIVE_ACTIVITY_OUTPUT_PROPERTIES,
    },
  },
}
