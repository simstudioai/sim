import {
  mapPlaceholderMapping,
  mapProject,
  PLACEHOLDER_MAPPING_OUTPUT_PROPERTIES,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneProjectPlaceholdersResponse,
  type RocketlaneUnassignPlaceholdersParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUnassignPlaceholdersTool: ToolConfig<
  RocketlaneUnassignPlaceholdersParams,
  RocketlaneProjectPlaceholdersResponse
> = {
  id: 'rocketlane_unassign_placeholders',
  name: 'Rocketlane Unassign Placeholders',
  description: 'Unassign a placeholder from its user in a Rocketlane project',
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
    placeholderId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the placeholder to unassign',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/unassign-placeholders`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => [{ placeholderId: params.placeholderId }],
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        project: mapProject(data),
        placeholders: Array.isArray(data?.placeholders)
          ? data.placeholders.map(mapPlaceholderMapping)
          : [],
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The project after the placeholder was unassigned',
      properties: PROJECT_OUTPUT_PROPERTIES,
    },
    placeholders: {
      type: 'array',
      description: 'Placeholder-to-user mappings on the project',
      items: { type: 'object', properties: PLACEHOLDER_MAPPING_OUTPUT_PROPERTIES },
    },
  },
}
