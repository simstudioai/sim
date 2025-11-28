import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonCreateTeam')

export interface PylonCreateTeamParams {
  apiToken: string
  name?: string
  userIds?: string
}

export interface PylonCreateTeamResponse {
  success: boolean
  output: {
    team: any
    metadata: {
      operation: 'create_team'
      teamId: string
    }
    success: boolean
  }
}

export const pylonCreateTeamTool: ToolConfig<PylonCreateTeamParams, PylonCreateTeamResponse> = {
  id: 'pylon_create_team',
  name: 'Create Team in Pylon',
  description: 'Create a new team with specified properties',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
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
      description: 'Comma-separated user IDs to add as team members',
    },
  },

  request: {
    url: () => buildPylonUrl('/teams'),
    method: 'POST',
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
      handlePylonError(data, response.status, 'create_team')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        team: data.data,
        metadata: {
          operation: 'create_team' as const,
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
      description: 'Created team data',
      properties: {
        team: { type: 'object', description: 'Created team object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
