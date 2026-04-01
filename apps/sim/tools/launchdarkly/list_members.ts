import type {
  LaunchDarklyListMembersParams,
  LaunchDarklyListMembersResponse,
} from '@/tools/launchdarkly/types'
import { MEMBER_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyListMembersTool: ToolConfig<
  LaunchDarklyListMembersParams,
  LaunchDarklyListMembersResponse
> = {
  id: 'launchdarkly_list_members',
  name: 'LaunchDarkly List Members',
  description: 'List account members in your LaunchDarkly organization.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LaunchDarkly API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of members to return (default 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.set('limit', String(params.limit))
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/members${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { success: false, output: { members: [], totalCount: 0 }, error: error.message }
    }

    const data = await response.json()
    const members = (data.items ?? []).map((item: Record<string, unknown>) => ({
      id: (item._id as string) ?? null,
      email: item.email ?? null,
      firstName: item.firstName ?? null,
      lastName: item.lastName ?? null,
      role: item.role ?? null,
      lastSeen: item._lastSeen ?? null,
      creationDate: item.creationDate ?? null,
      verified: item._verified ?? false,
    }))

    return {
      success: true,
      output: {
        members,
        totalCount: (data.totalCount as number) ?? members.length,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'List of account members',
      items: {
        type: 'object',
        properties: MEMBER_OUTPUT_PROPERTIES,
      },
    },
    totalCount: { type: 'number', description: 'Total number of members' },
  },
}
