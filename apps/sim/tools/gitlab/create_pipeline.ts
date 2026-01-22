import type { GitLabCreatePipelineParams, GitLabCreatePipelineResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreatePipelineTool: ToolConfig<
  GitLabCreatePipelineParams,
  GitLabCreatePipelineResponse
> = {
  id: 'gitlab_create_pipeline',
  name: 'GitLab Create Pipeline',
  description: 'Trigger a new pipeline in a GitLab project',
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
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch or tag to run the pipeline on',
    },
    variables: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of variables for the pipeline (each with key, value, and optional variable_type)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/pipeline`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        ref: params.ref,
      }

      if (params.variables && params.variables.length > 0) {
        body.variables = params.variables
      }

      return body
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
      description: 'The created GitLab pipeline',
    },
  },
}
