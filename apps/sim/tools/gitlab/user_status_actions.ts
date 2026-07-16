import type { GitLabUserActionParams, GitLabUserActionResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * The GitLab admin user-state endpoints (`POST /users/:id/{block,unblock,...}`)
 * are identical in shape - a single `user_id` path param, no body, and a boolean
 * or user-object response. This factory builds one `ToolConfig` per action so
 * each is registered and selectable individually while the wiring stays DRY.
 * All require an administrator token with `admin_mode` on the instance.
 */
function createUserStatusActionTool(
  action: string,
  name: string,
  description: string
): ToolConfig<GitLabUserActionParams, GitLabUserActionResponse> {
  return {
    id: `gitlab_${action}_user`,
    name,
    description,
    version: '1.0.0',

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'GitLab admin Personal Access Token (admin_mode)',
      },
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
      },
      userId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the user to act on',
      },
    },

    request: {
      url: (params) => `${getGitLabApiBase(params.host)}/users/${params.userId}/${action}`,
      method: 'POST',
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

      // These endpoints return either `true` or the updated user object.
      const data = await response.json().catch(() => null)
      const user = data && typeof data === 'object' ? data : undefined

      return {
        success: true,
        output: {
          success: true,
          user,
        },
      }
    },

    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the action succeeded',
      },
      user: {
        type: 'object',
        description: 'The updated user, when returned by GitLab',
      },
    },
  }
}

export const gitlabBlockUserTool = createUserStatusActionTool(
  'block',
  'GitLab Block User',
  'Block a GitLab user, preventing them from signing in or accessing the instance'
)

export const gitlabUnblockUserTool = createUserStatusActionTool(
  'unblock',
  'GitLab Unblock User',
  'Unblock a previously blocked GitLab user'
)

export const gitlabDeactivateUserTool = createUserStatusActionTool(
  'deactivate',
  'GitLab Deactivate User',
  'Deactivate a dormant GitLab user'
)

export const gitlabActivateUserTool = createUserStatusActionTool(
  'activate',
  'GitLab Activate User',
  'Reactivate a deactivated GitLab user'
)

export const gitlabBanUserTool = createUserStatusActionTool(
  'ban',
  'GitLab Ban User',
  'Ban a GitLab user'
)

export const gitlabUnbanUserTool = createUserStatusActionTool(
  'unban',
  'GitLab Unban User',
  'Unban a previously banned GitLab user'
)

export const gitlabApproveUserTool = createUserStatusActionTool(
  'approve',
  'GitLab Approve User',
  'Approve a GitLab user whose signup is pending administrator approval'
)

export const gitlabRejectUserTool = createUserStatusActionTool(
  'reject',
  'GitLab Reject User',
  'Reject a GitLab user whose signup is pending administrator approval'
)
