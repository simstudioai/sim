import type { ToolConfig } from '@/tools/types'
import type { GoogleGroupsCreateParams, GoogleGroupsResponse } from './types'

export const createGroupTool: ToolConfig<GoogleGroupsCreateParams, GoogleGroupsResponse> = {
  id: 'google_groups_create_group',
  name: 'Google Groups Create Group',
  description: 'Create a new Google Group in the domain',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address for the new group (e.g., team@yourdomain.com)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the group',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the group',
    },
  },

  request: {
    url: () => 'https://admin.googleapis.com/admin/directory/v1/groups',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {
        email: params.email,
        name: params.name,
      }

      if (params.description) {
        body.description = params.description
      }

      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create group')
    }
    return {
      success: true,
      output: { group: data },
    }
  },

  outputs: {
    group: { type: 'json', description: 'Created group object' },
  },
}
