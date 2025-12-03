import type {
  GitLabGetMergeRequestParams,
  GitLabGetMergeRequestResponse,
} from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetMergeRequestTool: ToolConfig<
  GitLabGetMergeRequestParams,
  GitLabGetMergeRequestResponse
> = {
  id: 'gitlab_get_merge_request',
  name: 'GitLab Get Merge Request',
  description: 'Get details of a specific GitLab merge request',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'gitlab',
  },

  params: {
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
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/merge_requests/${params.mergeRequestIid}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for GitLab API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
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
      description: 'The GitLab merge request details',
    },
  },
}
