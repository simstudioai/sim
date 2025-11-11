import type { AsanaGetProjectsParams, AsanaGetProjectsResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaGetProjectsTool: ToolConfig<AsanaGetProjectsParams, AsanaGetProjectsResponse> = {
  id: 'asana_get_projects',
  name: 'Asana Get Projects',
  description: 'Retrieve all projects from an Asana workspace',
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
    workspace: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Workspace GID to retrieve projects from',
    },
  },

  request: {
    url: '/api/tools/asana/get-projects',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      workspace: params.workspace,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        error: 'Empty response from Asana',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), projects: [] },
      error: data.error,
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description: 'List of projects with their gid, name, and resource type',
    },
  },
}
