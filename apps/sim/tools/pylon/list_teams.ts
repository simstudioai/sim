import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListTeams')

export interface PylonListTeamsParams {
  apiToken: string
}

export interface PylonListTeamsResponse {
  success: boolean
  output: {
    teams: any[]
    metadata: {
      operation: 'list_teams'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonListTeamsTool: ToolConfig<PylonListTeamsParams, PylonListTeamsResponse> = {
  id: 'pylon_list_teams',
  name: 'List Teams in Pylon',
  description: 'Retrieve a list of teams',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
  },

  request: {
    url: () => buildPylonUrl('/teams'),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'list_teams')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        teams: data.data || [],
        metadata: {
          operation: 'list_teams' as const,
          totalReturned: data.data?.length || 0,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'List of teams',
      properties: {
        teams: { type: 'array', description: 'Array of team objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
