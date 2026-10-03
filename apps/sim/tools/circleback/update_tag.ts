import {
  type CirclebackTagResponse,
  type CirclebackUpdateTagParams,
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

export const updateTagTool: ToolConfig<CirclebackUpdateTagParams, CirclebackTagResponse> = {
  id: 'circleback_update_tag',
  name: 'Circleback Update Tag',
  description: 'Updates the name or description of a Circleback tag.',
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
    tagName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new display name of the tag',
    },
    tagDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new description of the tag',
    },
  },

  request: {
    url: (params) => `${CIRCLEBACK_API_BASE}/tag/${safeUrlPathSegment(params.tagId, 'tagId')}`,
    method: 'PUT',
    headers: (params) => circlebackHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.tagName) body.name = params.tagName
      if (params.tagDescription) body.description = params.tagDescription
      return body
    },
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
