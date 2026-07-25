import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeleteProjectParams,
  type RocketlaneProjectDeleteResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteProjectTool: ToolConfig<
  RocketlaneDeleteProjectParams,
  RocketlaneProjectDeleteResponse
> = {
  id: 'rocketlane_delete_project',
  name: 'Rocketlane Delete Project',
  description:
    'Permanently delete a Rocketlane project by ID (irreversible; only Admins, Super Users, and Project Owners can delete)',
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
      description: 'Unique identifier of the project to delete',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeleteProjectParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, projectId: params?.projectId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the project was deleted' },
    projectId: {
      type: 'number',
      description: 'Unique identifier of the deleted project',
      optional: true,
    },
  },
}
