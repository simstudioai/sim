import type {
  GoogleGroupsRemoveMemberParams,
  GoogleGroupsResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const removeMemberTool: ToolConfig<GoogleGroupsRemoveMemberParams, GoogleGroupsResponse> = {
  id: 'google_groups_remove_member',
  name: 'Google Groups Remove Member',
  description: 'Remove a member from a Google Group',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-groups',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    groupKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Group identifier. Can be the group email address (e.g., team@example.com) or the unique group ID',
    },
    memberKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Member identifier to remove. Can be the member email address (e.g., user@example.com) or the unique member ID',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      const encodedMemberKey = encodeURIComponent(params.memberKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/members/${encodedMemberKey}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error?.message || 'Failed to remove member from group')
    }
    return {
      success: true,
      output: { message: 'Member removed successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success message' },
  },
}
