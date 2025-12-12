import type { ToolConfig } from '@/tools/types'
import type { GoogleGroupsHasMemberParams, GoogleGroupsResponse } from './types'

export const hasMemberTool: ToolConfig<GoogleGroupsHasMemberParams, GoogleGroupsResponse> = {
  id: 'google_groups_has_member',
  name: 'Google Groups Has Member',
  description: 'Check if a user is a member of a Google Group',
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
      description: 'Member email address or unique member ID to check',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      const encodedMemberKey = encodeURIComponent(params.memberKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}/hasMember/${encodedMemberKey}`
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
      throw new Error(data.error?.message || 'Failed to check membership')
    }
    return {
      success: true,
      output: { isMember: data.isMember },
    }
  },

  outputs: {
    isMember: { type: 'boolean', description: 'Whether the user is a member of the group' },
  },
}
