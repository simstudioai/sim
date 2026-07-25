import { truncate } from '@sim/utils/string'
import type { GitLabGetJobLogParams, GitLabGetJobLogResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Job traces can reach ~100 MB on gitlab.com (more on self-managed); cap what
 * is returned into the workflow payload so a huge trace cannot blow up the
 * execution log. 200k characters comfortably covers failure diagnosis.
 */
const MAX_LOG_CHARS = 200_000

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
      description: 'Project ID or path (e.g. mygroup/myproject)',
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

    const fullLog = await response.text()

    return {
      success: true,
      output: {
        log: truncate(fullLog, MAX_LOG_CHARS),
        truncated: fullLog.length > MAX_LOG_CHARS,
      },
    }
  },

  outputs: {
    log: {
      type: 'string',
      description: 'The job log (trace) output, truncated to 200k characters',
    },
    truncated: {
      type: 'boolean',
      description: 'Whether the log was truncated',
    },
  },
}
