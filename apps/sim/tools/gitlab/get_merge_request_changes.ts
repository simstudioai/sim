import type {
  GitLabGetMergeRequestChangesParams,
  GitLabGetMergeRequestChangesResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetMergeRequestChangesTool: ToolConfig<
  GitLabGetMergeRequestChangesParams,
  GitLabGetMergeRequestChangesResponse
> = {
  id: 'gitlab_get_merge_request_changes',
  name: 'GitLab Get Merge Request Changes',
  description: 'Get the file changes (diffs) of a GitLab merge request',
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
  },

  request: {
    /**
     * Uses the `/diffs` endpoint (the `/changes` endpoint was deprecated in
     * GitLab 15.7 and removed in 18.0). `/diffs` returns the diff array directly
     * and is paginated; we request the max page size (100) to return the changes
     * in a single call, which covers the vast majority of merge requests.
     */
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/merge_requests/${params.mergeRequestIid}/diffs?per_page=100`
    },
    method: 'GET',
    headers: (params) => ({
      'PRIVATE-TOKEN': params.accessToken,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `GitLab API error: ${response.status} ${errorText}`,
        output: {},
      }
    }

    const data = await response.json()
    const changes = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        mergeRequestIid: params?.mergeRequestIid ?? null,
        changes,
        changesCount: changes.length,
      },
    }
  },

  outputs: {
    mergeRequestIid: {
      type: 'number',
      description: 'The merge request internal ID (IID)',
    },
    changes: {
      type: 'array',
      description: 'List of file changes (diffs)',
    },
    changesCount: {
      type: 'number',
      description: 'Number of changed files returned',
    },
  },
}
