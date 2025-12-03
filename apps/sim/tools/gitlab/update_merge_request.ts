import type {
  GitLabUpdateMergeRequestParams,
  GitLabUpdateMergeRequestResponse,
} from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabUpdateMergeRequestTool: ToolConfig<
  GitLabUpdateMergeRequestParams,
  GitLabUpdateMergeRequestResponse
> = {
  id: 'gitlab_update_merge_request',
  name: 'GitLab Update Merge Request',
  description: 'Update an existing merge request in a GitLab project',
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
    mergeRequestIid: {
      type: 'number',
      required: true,
      description: 'Merge request internal ID (IID)',
    },
    title: {
      type: 'string',
      required: false,
      description: 'New merge request title',
    },
    description: {
      type: 'string',
      required: false,
      description: 'New merge request description',
    },
    stateEvent: {
      type: 'string',
      required: false,
      description: 'State event (close or reopen)',
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
    targetBranch: {
      type: 'string',
      required: false,
      description: 'New target branch',
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
      return `https://gitlab.com/api/v4/projects/${encodedId}/merge_requests/${params.mergeRequestIid}`
    },
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.title) body.title = params.title
      if (params.description !== undefined) body.description = params.description
      if (params.stateEvent) body.state_event = params.stateEvent
      if (params.labels !== undefined) body.labels = params.labels
      if (params.assigneeIds !== undefined) body.assignee_ids = params.assigneeIds
      if (params.milestoneId !== undefined) body.milestone_id = params.milestoneId
      if (params.targetBranch) body.target_branch = params.targetBranch
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
      description: 'The updated GitLab merge request',
    },
  },
}
