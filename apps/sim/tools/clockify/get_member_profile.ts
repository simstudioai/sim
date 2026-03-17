import type {
  ClockifyGetMemberProfileParams,
  ClockifyGetMemberProfileResponse,
} from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetMemberProfileTool: ToolConfig<
  ClockifyGetMemberProfileParams,
  ClockifyGetMemberProfileResponse
> = {
  id: 'clockify_get_member_profile',
  name: 'Clockify Get Member Profile',
  description: 'Get a member profile from a Clockify workspace',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Clockify API key',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to get the member profile for',
    },
  },

  request: {
    url: (params) =>
      `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/member-profile/${params.userId}`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get member profile')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    workCapacity: {
      type: 'string',
      description: 'Work capacity of the member',
    },
    costRate: {
      type: 'json',
      description: 'Cost rate information for the member',
    },
    weeklyWorkingDays: {
      type: 'json',
      description: 'Weekly working days configuration',
    },
  },
}
