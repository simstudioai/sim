import {
  type CirclebackListTagsParams,
  type CirclebackTagListResponse,
  TAG_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapTag,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const listTagsTool: ToolConfig<CirclebackListTagsParams, CirclebackTagListResponse> = {
  id: 'circleback_list_tags',
  name: 'Circleback List Tags',
  description: 'Lists every tag available to the authenticated Circleback user.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
  },

  request: {
    url: () => `${CIRCLEBACK_API_BASE}/tag`,
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        tags: (Array.isArray(data) ? data : []).map(mapTag),
      },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'Every tag available to the authenticated user',
      items: { type: 'object', properties: TAG_OUTPUT_PROPERTIES },
    },
  },
}
