import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeleteSpaceParams,
  type RocketlaneDeleteSpaceResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteSpaceTool: ToolConfig<
  RocketlaneDeleteSpaceParams,
  RocketlaneDeleteSpaceResponse
> = {
  id: 'rocketlane_delete_space',
  name: 'Rocketlane Delete Space',
  description: 'Permanently delete a Rocketlane space by its ID',
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
      description: 'ID of the space to delete',
    },
  },

  request: {
    url: (params) => `${ROCKETLANE_API_BASE}/spaces/${encodeURIComponent(params.spaceId)}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeleteSpaceParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, spaceId: params?.spaceId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the space was deleted' },
    spaceId: { type: 'number', description: 'ID of the deleted space', optional: true },
  },
}
