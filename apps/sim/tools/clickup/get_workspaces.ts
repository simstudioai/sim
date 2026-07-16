import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpWorkspace,
} from '@/tools/clickup/shared'
import type {
  ClickUpGetWorkspacesParams,
  ClickUpWorkspaceListResponse,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetWorkspacesTool: ToolConfig<
  ClickUpGetWorkspacesParams,
  ClickUpWorkspaceListResponse
> = {
  id: 'clickup_get_workspaces',
  name: 'ClickUp Get Workspaces',
  description: 'List the ClickUp workspaces (teams) available to the connected account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
  },

  request: {
    url: `${CLICKUP_API_BASE_URL}/team`,
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get workspaces')
      return { success: false, output: { error }, error }
    }

    const rawTeams = Array.isArray(data?.teams) ? data.teams : []

    return {
      success: true,
      output: { workspaces: rawTeams.map((team: unknown) => mapClickUpWorkspace(team)) },
    }
  },

  outputs: {
    workspaces: {
      type: 'array',
      description: 'Workspaces available to the connected account',
      optional: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workspace ID' },
          name: { type: 'string', description: 'Workspace name', nullable: true },
          color: { type: 'string', description: 'Workspace color', nullable: true },
          avatar: { type: 'string', description: 'Workspace avatar URL', nullable: true },
        },
      },
    },
  },
}
