import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonGetTeam')

export interface PylonGetTeamParams {
  apiToken: string
  teamId: string
}

export interface PylonGetTeamResponse {
  success: boolean
  output: {
    team: any
    metadata: {
      operation: 'get_team'
      teamId: string
    }
    success: boolean
  }
}

export const pylonGetTeamTool: ToolConfig<PylonGetTeamParams, PylonGetTeamResponse> = {
  id: 'pylon_get_team',
  name: 'Get Team in Pylon',
  description: 'Retrieve a specific team by ID',
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
      description: 'Team ID to retrieve',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/teams/${params.teamId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'get_team')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        team: data.data,
        metadata: {
          operation: 'get_team' as const,
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
      description: 'Team data',
      properties: {
        team: { type: 'object', description: 'Team object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
