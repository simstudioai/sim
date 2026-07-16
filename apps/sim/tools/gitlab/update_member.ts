import type { GitLabUpdateMemberParams, GitLabUpdateMemberResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabUpdateMemberTool: ToolConfig<
  GitLabUpdateMemberParams,
  GitLabUpdateMemberResponse
> = {
  id: 'gitlab_update_member',
  name: 'GitLab Update Member',
  description: "Update a member's access level in a GitLab project or group",
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
    resourceType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Whether the resource is a 'project' or a 'group'",
    },
    resourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project or group ID or path (e.g. mygroup/myproject)',
    },
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the member to update',
    },
    accessLevel: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New access level: 0 (No access), 5 (Minimal), 10 (Guest), 15 (Planner), 20 (Reporter), 25 (Security Manager), 30 (Developer), 40 (Maintainer), 50 (Owner)',
    },
    expiresAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Access expiration date in YYYY-MM-DD format. Pass an empty string to clear an existing expiration.',
    },
    memberRoleId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom member role ID (GitLab Ultimate only). Warning: when omitted, GitLab removes any custom role the member currently holds.',
    },
  },

  request: {
    url: (params) => {
      const resourcePath = getGitLabResourcePath(params.resourceType, params.resourceId)
      return `${getGitLabApiBase(params.host)}/${resourcePath}/members/${params.userId}`
    },
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        access_level: params.accessLevel,
      }

      // Send explicit empty string too, which clears an existing expiration.
      if (params.expiresAt !== undefined) body.expires_at = params.expiresAt
      if (params.memberRoleId !== undefined) body.member_role_id = params.memberRoleId

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

    const member = await response.json()

    return {
      success: true,
      output: {
        member,
      },
    }
  },

  outputs: {
    member: {
      type: 'object',
      description: 'The updated member',
    },
  },
}
