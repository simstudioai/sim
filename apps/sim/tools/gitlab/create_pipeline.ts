import type { GitLabCreatePipelineParams, GitLabCreatePipelineResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
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
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or path (e.g. mygroup/myproject)',
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
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/pipeline`
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
