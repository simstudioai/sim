import type { GitLabRetryPipelineParams, GitLabRetryPipelineResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabRetryPipelineTool: ToolConfig<
  GitLabRetryPipelineParams,
  GitLabRetryPipelineResponse
> = {
  id: 'gitlab_retry_pipeline',
  name: 'GitLab Retry Pipeline',
  description: 'Retry a failed GitLab pipeline',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or URL-encoded path',
    },
    pipelineId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pipeline ID',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/pipelines/${params.pipelineId}/retry`
    },
    method: 'POST',
    headers: (params) => ({
      'PRIVATE-TOKEN': params.accessToken,
    }),
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
      description: 'The retried GitLab pipeline',
    },
  },
}
