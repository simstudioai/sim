import type { GitLabGetGroupParams, GitLabGetGroupResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetGroupTool: ToolConfig<GitLabGetGroupParams, GitLabGetGroupResponse> = {
  id: 'gitlab_get_group',
  name: 'GitLab Get Group',
  description: 'Get details of a specific GitLab group',
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
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID or path (e.g. mygroup or parent/subgroup)',
    },
  },

  request: {
    url: (params) => {
      return `${getGitLabApiBase(params.host)}/${getGitLabResourcePath('group', params.groupId)}`
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

    const group = await response.json()

    return {
      success: true,
      output: {
        group,
      },
    }
  },

  outputs: {
    group: {
      type: 'object',
      description: 'The GitLab group details',
    },
  },
}
