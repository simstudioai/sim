import type {
  GitLabCreateMergeRequestParams,
  GitLabCreateMergeRequestResponse,
} from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateMergeRequestTool: ToolConfig<
  GitLabCreateMergeRequestParams,
  GitLabCreateMergeRequestResponse
> = {
  id: 'gitlab_create_merge_request',
  name: 'GitLab Create Merge Request',
  description: 'Create a new merge request in a GitLab project',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'GitLab Personal Access Token',
    },
    projectId: {
      type: 'string',
      required: true,
      description: 'Project ID or URL-encoded path',
    },
    sourceBranch: {
      type: 'string',
      required: true,
      description: 'Source branch name',
    },
    targetBranch: {
      type: 'string',
      required: true,
      description: 'Target branch name',
    },
    title: {
      type: 'string',
      required: true,
      description: 'Merge request title',
    },
    description: {
      type: 'string',
      required: false,
      description: 'Merge request description (Markdown supported)',
    },
    labels: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of label names',
    },
    assigneeIds: {
      type: 'array',
      required: false,
      description: 'Array of user IDs to assign',
    },
    milestoneId: {
      type: 'number',
      required: false,
      description: 'Milestone ID to assign',
    },
    removeSourceBranch: {
      type: 'boolean',
      required: false,
      description: 'Delete source branch after merge',
    },
    squash: {
      type: 'boolean',
      required: false,
      description: 'Squash commits on merge',
    },
    draft: {
      type: 'boolean',
      required: false,
      description: 'Mark as draft (work in progress)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/merge_requests`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        source_branch: params.sourceBranch,
        target_branch: params.targetBranch,
        title: params.title,
      }

      if (params.description) body.description = params.description
      if (params.labels) body.labels = params.labels
      if (params.assigneeIds && params.assigneeIds.length > 0)
        body.assignee_ids = params.assigneeIds
      if (params.milestoneId) body.milestone_id = params.milestoneId
      if (params.removeSourceBranch !== undefined)
        body.remove_source_branch = params.removeSourceBranch
      if (params.squash !== undefined) body.squash = params.squash
      if (params.draft !== undefined) body.draft = params.draft

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

    const mergeRequest = await response.json()

    return {
      success: true,
      output: {
        mergeRequest,
      },
    }
  },

  outputs: {
    mergeRequest: {
      type: 'object',
      description: 'The created GitLab merge request',
    },
  },
}
