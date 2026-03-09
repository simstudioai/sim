import type { GongListWorkspacesParams, GongListWorkspacesResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listWorkspacesTool: ToolConfig<GongListWorkspacesParams, GongListWorkspacesResponse> =
  {
    id: 'gong_list_workspaces',
    name: 'Gong List Workspaces',
    description: 'List all company workspaces in Gong.',
    version: '1.0.0',

    params: {
      accessKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Gong API Access Key',
      },
      accessKeySecret: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Gong API Access Key Secret',
      },
    },

    request: {
      url: 'https://api.gong.io/v2/workspaces',
      method: 'GET',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list workspaces')
      }
      const workspaces = (data.workspaces ?? []).map((w: Record<string, unknown>) => ({
        id: w.id ?? '',
        name: w.name ?? null,
        description: w.description ?? null,
      }))
      return {
        success: true,
        output: { workspaces },
      }
    },

    outputs: {
      workspaces: {
        type: 'array',
        description: 'List of Gong workspaces',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Gong unique numeric identifier for the workspace' },
            name: { type: 'string', description: 'Display name of the workspace' },
            description: {
              type: 'string',
              description: "Description of the workspace's purpose or content",
            },
          },
        },
      },
    },
  }
