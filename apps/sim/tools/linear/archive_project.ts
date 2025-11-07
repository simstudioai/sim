import type { LinearArchiveProjectParams, LinearArchiveProjectResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearArchiveProjectTool: ToolConfig<
  LinearArchiveProjectParams,
  LinearArchiveProjectResponse
> = {
  id: 'linear_archive_project',
  name: 'Linear Archive Project',
  description: 'Archive a project in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID to archive',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        mutation ArchiveProject($id: String!) {
          projectArchive(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.projectId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to archive project',
        output: {},
      }
    }

    return {
      success: data.data.projectArchive.success,
      output: {
        success: data.data.projectArchive.success,
        projectId: response.ok ? data.data.projectArchive.success : '',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the archive operation was successful',
    },
    projectId: {
      type: 'string',
      description: 'The ID of the archived project',
    },
  },
}
