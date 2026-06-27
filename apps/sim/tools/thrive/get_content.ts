import type { ThriveContentResponse, ThriveGetContentParams } from '@/tools/thrive/types'
import { THRIVE_CONTENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getContentTool: ToolConfig<ThriveGetContentParams, ThriveContentResponse> = {
  id: 'thrive_get_content',
  name: 'Thrive Get Content',
  description: 'Get a single content record in Thrive by its ID.',
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
      description: 'Unique identifier of the content item',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/contents/${encodeURIComponent(params.id)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveContentResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get content')
    return { success: true, output: { content: data ?? null } }
  },

  outputs: {
    content: {
      type: 'object',
      description: 'The content record',
      properties: THRIVE_CONTENT_OUTPUT_PROPERTIES,
    },
  },
}
