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
      visibility: 'user-or-llm',
      description: 'Asana workspace GID (numeric string) to retrieve projects from',
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
        output: {},
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
    projects: {
      type: 'array',
      description: 'Array of projects',
      items: {
        type: 'object',
        properties: {
          gid: { type: 'string', description: 'Project GID' },
          name: { type: 'string', description: 'Project name' },
          resource_type: { type: 'string', description: 'Resource type (project)' },
        },
      },
    },
  },
}
