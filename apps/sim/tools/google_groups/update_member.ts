import type { ToolConfig } from '@/tools/types'
import type { GoogleGroupsResponse, GoogleGroupsUpdateMemberParams } from './types'

export const updateMemberTool: ToolConfig<GoogleGroupsUpdateMemberParams, GoogleGroupsResponse> = {
  id: 'google_groups_update_member',
  name: 'Google Groups Update Member',
  description: "Update a member's role in a Google Group (promote or demote)",
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
      description: 'Group email address or unique group ID',
    },
    memberKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Member email address or unique member ID',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New role for the member (MEMBER, MANAGER, or OWNER)',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      const encodedMemberKey = encodeURIComponent(params.memberKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/members/${encodedMemberKey}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return JSON.stringify({
        role: params.role,
      })
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to update member role')
    }
    return {
      success: true,
      output: { member: data },
    }
  },

  outputs: {
    member: { type: 'json', description: 'Updated member object' },
  },
}
