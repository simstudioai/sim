import type {
  GitLabMergeMergeRequestParams,
  GitLabMergeMergeRequestResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabMergeMergeRequestTool: ToolConfig<
  GitLabMergeMergeRequestParams,
  GitLabMergeMergeRequestResponse
> = {
  id: 'gitlab_merge_merge_request',
  name: 'GitLab Merge Merge Request',
  description: 'Merge a merge request in a GitLab project',
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
    mergeRequestIid: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Merge request internal ID (IID)',
    },
    mergeCommitMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom merge commit message',
    },
    squashCommitMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom squash commit message',
    },
    squash: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Squash commits before merging',
    },
    shouldRemoveSourceBranch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete source branch after merge',
    },
    mergeWhenPipelineSucceeds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Merge when pipeline succeeds',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/merge_requests/${params.mergeRequestIid}/merge`
    },
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.mergeCommitMessage) body.merge_commit_message = params.mergeCommitMessage
      if (params.squashCommitMessage) body.squash_commit_message = params.squashCommitMessage
      if (params.squash !== undefined) body.squash = params.squash
      if (params.shouldRemoveSourceBranch !== undefined)
        body.should_remove_source_branch = params.shouldRemoveSourceBranch
      if (params.mergeWhenPipelineSucceeds !== undefined) {
        // `merge_when_pipeline_succeeds` was deprecated in GitLab 17.11 in
        // favor of `auto_merge`; send both so older self-managed instances
        // (which ignore unknown params) keep working.
        body.auto_merge = params.mergeWhenPipelineSucceeds
        body.merge_when_pipeline_succeeds = params.mergeWhenPipelineSucceeds
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
      description: 'The merged GitLab merge request',
    },
  },
}
