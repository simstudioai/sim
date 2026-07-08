import type { ThriveGetTagParams, ThriveTagResponse } from '@/tools/thrive/types'
import { THRIVE_TAG_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getTagTool: ToolConfig<ThriveGetTagParams, ThriveTagResponse> = {
  id: 'thrive_get_tag',
  name: 'Thrive Get Tag',
  description: 'Get a single tag in Thrive by its ID.',
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
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The tag ID',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/tags/${encodeURIComponent(params.tagId)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveTagResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get tag')
    return { success: true, output: { tag: data ?? null } }
  },

  outputs: {
    tag: {
      type: 'object',
      description: 'The tag',
      properties: THRIVE_TAG_OUTPUT_PROPERTIES,
    },
  },
}
