import type { GitLabPlayJobParams, GitLabPlayJobResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabPlayJobTool: ToolConfig<GitLabPlayJobParams, GitLabPlayJobResponse> = {
  id: 'gitlab_play_job',
  name: 'GitLab Play Job',
  description: 'Trigger (play) a manual GitLab job',
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
    jobVariables: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Variables for the manual job (array of objects with key and value)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/jobs/${params.jobId}/play`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.jobVariables && params.jobVariables.length > 0) {
        body.job_variables_attributes = params.jobVariables
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

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        name: data.name ?? null,
        status: data.status ?? null,
        webUrl: data.web_url ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'The job ID',
    },
    name: {
      type: 'string',
      description: 'The job name',
    },
    status: {
      type: 'string',
      description: 'The job status',
    },
    webUrl: {
      type: 'string',
      description: 'The web URL of the job',
    },
  },
}
