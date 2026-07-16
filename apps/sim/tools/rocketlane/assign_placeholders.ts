import {
  mapPlaceholderMapping,
  mapProject,
  PLACEHOLDER_MAPPING_OUTPUT_PROPERTIES,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneAssignPlaceholdersParams,
  type RocketlaneProjectPlaceholdersResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneAssignPlaceholdersTool: ToolConfig<
  RocketlaneAssignPlaceholdersParams,
  RocketlaneProjectPlaceholdersResponse
> = {
  id: 'rocketlane_assign_placeholders',
  name: 'Rocketlane Assign Placeholders',
  description: 'Assign a placeholder in a Rocketlane project to a user',
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
      description: 'Unique identifier of the placeholder to assign',
    },
    userId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID of the project member to assign (either userId or userEmailId must be provided; must be a customer user for CUSTOMER placeholders)',
    },
    userEmailId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Email of the project member to assign (either userId or userEmailId must be provided)',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/assign-placeholders`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const user: Record<string, unknown> = {}
      if (params.userId != null) user.userId = params.userId
      if (params.userEmailId) user.emailId = params.userEmailId
      return [{ placeholderId: params.placeholderId, user }]
    },
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
      description: 'The project after the placeholder assignment',
      properties: PROJECT_OUTPUT_PROPERTIES,
    },
    placeholders: {
      type: 'array',
      description: 'Placeholder-to-user mappings on the project',
      items: { type: 'object', properties: PLACEHOLDER_MAPPING_OUTPUT_PROPERTIES },
    },
  },
}
