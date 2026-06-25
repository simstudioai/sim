import type {
  GitLabListPipelineJobsParams,
  GitLabListPipelineJobsResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListPipelineJobsTool: ToolConfig<
  GitLabListPipelineJobsParams,
  GitLabListPipelineJobsResponse
> = {
  id: 'gitlab_list_pipeline_jobs',
  name: 'GitLab List Pipeline Jobs',
  description: 'List jobs for a GitLab pipeline',
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
      description: 'Project ID or URL-encoded path',
    },
    pipelineId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pipeline ID',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter jobs by scope (e.g. created, running, success, failed)',
    },
    includeRetried: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include retried jobs',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 20, max 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const queryParams = new URLSearchParams()

      if (params.scope) queryParams.append('scope', params.scope)
      if (params.includeRetried) queryParams.append('include_retried', 'true')
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/pipelines/${params.pipelineId}/jobs${query ? `?${query}` : ''}`
    },
    method: 'GET',
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

    const jobs = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        jobs: jobs ?? [],
        total: total ? Number.parseInt(total, 10) : (jobs?.length ?? 0),
      },
    }
  },

  outputs: {
    jobs: {
      type: 'array',
      description: 'List of pipeline jobs',
    },
    total: {
      type: 'number',
      description: 'Total number of jobs',
    },
  },
}
