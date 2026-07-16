import type { GitLabInviteMemberParams, GitLabInviteMemberResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabInviteMemberTool: ToolConfig<
  GitLabInviteMemberParams,
  GitLabInviteMemberResponse
> = {
  id: 'gitlab_invite_member',
  name: 'GitLab Invite Member',
  description: 'Invite a person to a GitLab project or group by email address',
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
      description: 'Project or group ID or URL-encoded path',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to invite (comma-separated for multiple)',
    },
    accessLevel: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Access level: 10 (Guest), 20 (Reporter), 30 (Developer), 40 (Maintainer), 50 (Owner)',
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
      return `${getGitLabApiBase(params.host)}/${resourcePath}/invitations`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      // GitLab accepts a comma-separated list of emails in a single `email`
      // field. Normalize surrounding whitespace so "a@b.com, c@d.com" invites
      // both addresses rather than sending a malformed second entry.
      const email = String(params.email)
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean)
        .join(',')

      const body: Record<string, unknown> = {
        email,
        access_level: params.accessLevel,
      }

      if (params.expiresAt) body.expires_at = params.expiresAt
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

    const data = await response.json()

    // GitLab returns { status: 'error', message: {...} } with a 201 when an
    // individual email fails, so surface the failure rather than reporting success.
    if (data?.status === 'error') {
      return {
        success: false,
        error:
          typeof data.message === 'string' ? data.message : JSON.stringify(data.message ?? data),
        output: {
          status: data.status,
          message: data.message,
        },
      }
    }

    return {
      success: true,
      output: {
        status: data?.status ?? 'success',
        message: data?.message,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Invitation status returned by GitLab',
    },
    message: {
      type: 'object',
      description: 'Per-email result detail, if any',
    },
  },
}
