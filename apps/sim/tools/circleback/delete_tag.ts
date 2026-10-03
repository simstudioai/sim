import {
  type CirclebackDeleteTagParams,
  type CirclebackTagResponse,
  TAG_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapTag,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteTagTool: ToolConfig<CirclebackDeleteTagParams, CirclebackTagResponse> = {
  id: 'circleback_delete_tag',
  name: 'Circleback Delete Tag',
  description:
    'Permanently deletes a Circleback tag and removes it from every meeting it was applied to.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the tag',
    },
  },

  request: {
    url: (params) => `${CIRCLEBACK_API_BASE}/tag/${safeUrlPathSegment(params.tagId, 'tagId')}`,
    method: 'DELETE',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: mapTag(data),
    }
  },

  outputs: TAG_OUTPUT_PROPERTIES,
}
