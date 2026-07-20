import {
  mapSpace,
  ROCKETLANE_API_BASE,
  type RocketlaneSpaceResponse,
  type RocketlaneUpdateSpaceParams,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdateSpaceTool: ToolConfig<
  RocketlaneUpdateSpaceParams,
  RocketlaneSpaceResponse
> = {
  id: 'rocketlane_update_space',
  name: 'Rocketlane Update Space',
  description: 'Update a Rocketlane space by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    spaceId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the space to update',
    },
    spaceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the space',
    },
  },

  request: {
    url: (params) => `${ROCKETLANE_API_BASE}/spaces/${encodeURIComponent(params.spaceId)}`,
    method: 'PUT',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.spaceName != null) body.spaceName = params.spaceName
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
      description: 'The updated space',
      properties: SPACE_OUTPUT_PROPERTIES,
    },
  },
}
