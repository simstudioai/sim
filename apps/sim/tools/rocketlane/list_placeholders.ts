import {
  mapPagination,
  mapPlaceholder,
  PAGINATION_OUTPUT_PROPERTIES,
  PLACEHOLDER_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListPlaceholdersParams,
  type RocketlanePlaceholderListResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListPlaceholdersTool: ToolConfig<
  RocketlaneListPlaceholdersParams,
  RocketlanePlaceholderListResponse
> = {
  id: 'rocketlane_list_placeholders',
  name: 'Rocketlane List Placeholders',
  description: 'List the placeholders of a Rocketlane project',
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
      description: 'Unique identifier of the project',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/get-placeholders`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        placeholders: Array.isArray(data?.data) ? data.data.map(mapPlaceholder) : [],
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    placeholders: {
      type: 'array',
      description: 'Placeholders of the project',
      items: { type: 'object', properties: PLACEHOLDER_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for fetching further pages',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
