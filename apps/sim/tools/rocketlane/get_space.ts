import {
  mapSpace,
  ROCKETLANE_API_BASE,
  type RocketlaneGetSpaceParams,
  type RocketlaneSpaceResponse,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetSpaceTool: ToolConfig<RocketlaneGetSpaceParams, RocketlaneSpaceResponse> =
  {
    id: 'rocketlane_get_space',
    name: 'Rocketlane Get Space',
    description: 'Retrieve a Rocketlane space by its ID',
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
        description: 'ID of the space to retrieve',
      },
    },

    request: {
      url: (params) => `${ROCKETLANE_API_BASE}/spaces/${encodeURIComponent(params.spaceId)}`,
      method: 'GET',
      headers: (params) => rocketlaneHeaders(params.apiKey),
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
        description: 'The requested space',
        properties: SPACE_OUTPUT_PROPERTIES,
      },
    },
  }
