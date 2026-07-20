import {
  ROCKETLANE_API_BASE,
  type RocketlaneArchiveProjectParams,
  type RocketlaneProjectArchiveResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneArchiveProjectTool: ToolConfig<
  RocketlaneArchiveProjectParams,
  RocketlaneProjectArchiveResponse
> = {
  id: 'rocketlane_archive_project',
  name: 'Rocketlane Archive Project',
  description:
    'Archive a Rocketlane project by ID, making it dormant while preserving its details and history',
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
      description: 'Unique identifier of the project to archive',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/archive`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneArchiveProjectParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { archived: true, projectId: params?.projectId ?? null },
    }
  },

  outputs: {
    archived: { type: 'boolean', description: 'Whether the project was archived' },
    projectId: {
      type: 'number',
      description: 'Unique identifier of the archived project',
      optional: true,
    },
  },
}
