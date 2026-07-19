import type { AsanaListWorkspacesParams, AsanaListWorkspacesResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaListWorkspacesTool: ToolConfig<
  AsanaListWorkspacesParams,
  AsanaListWorkspacesResponse
> = {
  id: 'asana_list_workspaces',
  name: 'Asana List Workspaces',
  description: 'List all Asana workspaces and organizations the authenticated user belongs to',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'asana',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Asana',
    },
  },

  request: {
    url: '/api/tools/asana/list-workspaces',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), workspaces: [] },
        error: 'Empty response from Asana',
      }
    }

    const data = JSON.parse(responseText)
    const { success, error, ...output } = data
    return {
      success: success ?? true,
      output,
      error,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    ts: { type: 'string', description: 'Timestamp of the response' },
    workspaces: {
      type: 'array',
      description: 'Array of workspaces',
      items: {
        type: 'object',
        properties: {
          gid: { type: 'string', description: 'Workspace GID' },
          name: { type: 'string', description: 'Workspace name' },
          resource_type: { type: 'string', description: 'Resource type (workspace)' },
        },
      },
    },
  },
}
