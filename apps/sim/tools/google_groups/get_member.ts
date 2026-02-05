import type { GoogleGroupsGetMemberParams, GoogleGroupsResponse } from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const getMemberTool: ToolConfig<GoogleGroupsGetMemberParams, GoogleGroupsResponse> = {
  id: 'google_groups_get_member',
  name: 'Google Groups Get Member',
  description: 'Get details of a specific member in a Google Group',
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
        'Member identifier. Can be the member email address (e.g., user@example.com) or the unique member ID',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      const encodedMemberKey = encodeURIComponent(params.memberKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/members/${encodedMemberKey}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get group member')
    }
    return {
      success: true,
      output: { member: data },
    }
  },

  outputs: {
    member: { type: 'json', description: 'Member object' },
  },
}
