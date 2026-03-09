import type { GoogleGroupsAddMemberParams, GoogleGroupsResponse } from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const addMemberTool: ToolConfig<GoogleGroupsAddMemberParams, GoogleGroupsResponse> = {
  id: 'google_groups_add_member',
  name: 'Google Groups Add Member',
  description: 'Add a new member to a Google Group',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the member to add (e.g., user@example.com)',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Role for the member: MEMBER, MANAGER, or OWNER. Defaults to MEMBER',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/members`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {
        email: params.email,
        role: params.role || 'MEMBER',
      }

      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to add member to group')
    }
    return {
      success: true,
      output: { member: data },
    }
  },

  outputs: {
    member: { type: 'json', description: 'Added member object' },
  },
}
