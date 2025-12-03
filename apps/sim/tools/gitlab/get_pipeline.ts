import type { GitLabGetPipelineParams, GitLabGetPipelineResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetPipelineTool: ToolConfig<GitLabGetPipelineParams, GitLabGetPipelineResponse> =
  {
    id: 'gitlab_get_pipeline',
    name: 'GitLab Get Pipeline',
    description: 'Get details of a specific GitLab pipeline',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'gitlab',
    },

    params: {
      projectId: {
        type: 'string',
        required: true,
        description: 'Project ID or URL-encoded path',
      },
      pipelineId: {
        type: 'number',
        required: true,
        description: 'Pipeline ID',
      },
    },

    request: {
      url: (params) => {
        const encodedId = encodeURIComponent(String(params.projectId))
        return `https://gitlab.com/api/v4/projects/${encodedId}/pipelines/${params.pipelineId}`
      },
      method: 'GET',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Missing access token for GitLab API request')
        }
        return {
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `GitLab API error: ${response.status} ${errorText}`,
          output: {},
        }
      }

      const pipeline = await response.json()

      return {
        success: true,
        output: {
          pipeline,
        },
      }
    },

    outputs: {
      pipeline: {
        type: 'object',
        description: 'The GitLab pipeline details',
      },
    },
  }
