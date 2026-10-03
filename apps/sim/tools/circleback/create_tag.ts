import {
  type CirclebackCreateTagParams,
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

export const createTagTool: ToolConfig<CirclebackCreateTagParams, CirclebackTagResponse> = {
  id: 'circleback_create_tag',
  name: 'Circleback Create Tag',
  description:
    'Creates a new tag in Circleback. If a tag with the same name already exists, a conflict error is returned.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    tagName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The display name of the tag',
    },
    tagDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A description of the tag',
    },
  },

  request: {
    url: () => `${CIRCLEBACK_API_BASE}/tag`,
    method: 'POST',
    headers: (params) => circlebackHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, string> = { name: params.tagName }
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
