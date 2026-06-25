import type { GitLabGetJobLogParams, GitLabGetJobLogResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetJobLogTool: ToolConfig<GitLabGetJobLogParams, GitLabGetJobLogResponse> = {
  id: 'gitlab_get_job_log',
  name: 'GitLab Get Job Log',
  description: 'Get the log (trace) of a GitLab job',
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
    jobId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job ID',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/jobs/${params.jobId}/trace`
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

    const log = await response.text()

    return {
      success: true,
      output: {
        log,
      },
    }
  },

  outputs: {
    log: {
      type: 'string',
      description: 'The job log (trace) output',
    },
  },
}
