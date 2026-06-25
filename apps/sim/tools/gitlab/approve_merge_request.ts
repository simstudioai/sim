import type {
  GitLabApproveMergeRequestParams,
  GitLabApproveMergeRequestResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabApproveMergeRequestTool: ToolConfig<
  GitLabApproveMergeRequestParams,
  GitLabApproveMergeRequestResponse
> = {
  id: 'gitlab_approve_merge_request',
  name: 'GitLab Approve Merge Request',
  description: 'Approve a GitLab merge request',
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
    mergeRequestIid: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Merge request internal ID (IID)',
    },
    sha: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HEAD SHA of the merge request to approve',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/merge_requests/${params.mergeRequestIid}/approve`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.sha) body.sha = params.sha

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
        approvalsRequired: data.approvals_required ?? null,
        approvalsLeft: data.approvals_left ?? null,
        approvedBy: data.approved_by ?? [],
      },
    }
  },

  outputs: {
    approvalsRequired: {
      type: 'number',
      description: 'Number of approvals required',
    },
    approvalsLeft: {
      type: 'number',
      description: 'Number of approvals still needed',
    },
    approvedBy: {
      type: 'array',
      description: 'List of approvers',
    },
  },
}
