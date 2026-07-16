import type { GitLabAddMemberParams, GitLabAddMemberResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabAddMemberTool: ToolConfig<GitLabAddMemberParams, GitLabAddMemberResponse> = {
  id: 'gitlab_add_member',
  name: 'GitLab Add Member',
  description: 'Add an existing GitLab user to a project or group at a given access level',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the user to add. Provide either userId or username.',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The username of the user to add. Provide either userId or username.',
    },
    accessLevel: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Access level: 0 (No access), 5 (Minimal), 10 (Guest), 15 (Planner), 20 (Reporter), 25 (Security Manager), 30 (Developer), 40 (Maintainer), 50 (Owner)',
    },
    expiresAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Access expiration date in YYYY-MM-DD format',
    },
    memberRoleId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom member role ID (GitLab Ultimate only)',
    },
  },

  request: {
    url: (params) => {
      const resourcePath = getGitLabResourcePath(params.resourceType, params.resourceId)
      return `${getGitLabApiBase(params.host)}/${resourcePath}/members`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        access_level: params.accessLevel,
      }

      // GitLab accepts either user_id or username to identify the user.
      if (params.userId !== undefined && params.userId !== null) body.user_id = params.userId
      else if (params.username?.trim()) body.username = params.username.trim()

      if (params.expiresAt) body.expires_at = params.expiresAt
      if (params.memberRoleId !== undefined) body.member_role_id = params.memberRoleId

      return body
    },
  },

  transformResponse: async (response) => {
    // A 409 with "already exists" means the user is already a member. Treat it
    // as a soft success so provisioning workflows remain safely re-runnable —
    // but only for that specific conflict, so other 409s still surface.
    if (response.status === 409) {
      const conflictText = await response.text()
      if (/already exists|already a member/i.test(conflictText)) {
        return {
          success: true,
          output: {
            alreadyMember: true,
          },
        }
      }
      return {
        success: false,
        error: `GitLab API error: 409 ${conflictText}`,
        output: {},
      }
    }

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
        alreadyMember: false,
      },
    }
  },

  outputs: {
    member: {
      type: 'object',
      description: 'The added member',
    },
    alreadyMember: {
      type: 'boolean',
      description: 'Whether the user was already a member (add was a no-op)',
    },
  },
}
