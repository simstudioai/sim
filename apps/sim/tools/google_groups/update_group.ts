import type { GoogleGroupsResponse, GoogleGroupsUpdateParams } from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const updateGroupTool: ToolConfig<GoogleGroupsUpdateParams, GoogleGroupsResponse> = {
  id: 'google_groups_update_group',
  name: 'Google Groups Update Group',
  description: 'Update an existing Google Group',
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New display name for the group (e.g., Engineering Team)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the group',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New email address for the group (e.g., newteam@example.com)',
    },
  },

  request: {
    url: (params) => {
      const encodedGroupKey = encodeURIComponent(params.groupKey)
      return `https://admin.googleapis.com/admin/directory/v1/groups/${encodedGroupKey}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}

      if (params.name) {
        body.name = params.name
      }
      if (params.description) {
        body.description = params.description
      }
      if (params.email) {
        body.email = params.email
      }

      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to update group')
    }
    return {
      success: true,
      output: { group: data },
    }
  },

  outputs: {
    group: { type: 'json', description: 'Updated group object' },
  },
}
