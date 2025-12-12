import type { ToolConfig } from '@/tools/types'
import type { GoogleGroupsDeleteParams, GoogleGroupsResponse } from './types'

export const deleteGroupTool: ToolConfig<GoogleGroupsDeleteParams, GoogleGroupsResponse> = {
  id: 'google_groups_delete_group',
  name: 'Google Groups Delete Group',
  description: 'Delete a Google Group',
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
      description: 'Group email address or unique group ID to delete',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}`
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
      throw new Error(data.error?.message || 'Failed to delete group')
    }
    return {
      success: true,
      output: { message: 'Group deleted successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success message' },
  },
}
