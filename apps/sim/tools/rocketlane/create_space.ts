import {
  mapSpace,
  ROCKETLANE_API_BASE,
  type RocketlaneCreateSpaceParams,
  type RocketlaneSpaceResponse,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateSpaceTool: ToolConfig<
  RocketlaneCreateSpaceParams,
  RocketlaneSpaceResponse
> = {
  id: 'rocketlane_create_space',
  name: 'Rocketlane Create Space',
  description: 'Create a new space in a Rocketlane project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the project the space belongs to',
    },
    spaceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the space',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the space is private or shared (defaults to false)',
    },
  },

  request: {
    url: () => `${ROCKETLANE_API_BASE}/spaces`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        spaceName: params.spaceName,
        project: { projectId: params.projectId },
      }
      if (params.private != null) body.private = params.private
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { space: mapSpace(data) },
    }
  },

  outputs: {
    space: {
      type: 'object',
      description: 'The created space',
      properties: SPACE_OUTPUT_PROPERTIES,
    },
  },
}
