import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonUpdateTeam')

export interface PylonUpdateTeamParams {
  apiToken: string
  teamId: string
  name?: string
  userIds?: string
}

export interface PylonUpdateTeamResponse {
  success: boolean
  output: {
    team: any
    metadata: {
      operation: 'update_team'
      teamId: string
    }
    success: boolean
  }
}

export const pylonUpdateTeamTool: ToolConfig<PylonUpdateTeamParams, PylonUpdateTeamResponse> = {
  id: 'pylon_update_team',
  name: 'Update Team in Pylon',
  description:
    'Update an existing team with specified properties (userIds replaces entire membership)',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Team ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Team name',
    },
    userIds: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated user IDs (replaces entire team membership)',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/teams/${params.teamId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.name) body.name = params.name

      if (params.userIds) {
        body.user_ids = params.userIds.split(',').map((id) => id.trim())
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'update_team')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        team: data.data,
        metadata: {
          operation: 'update_team' as const,
          teamId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated team data',
      properties: {
        team: { type: 'object', description: 'Updated team object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
