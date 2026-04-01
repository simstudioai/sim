import type { ToolConfig } from '@/tools/types'
import type { TailscaleBaseParams, TailscaleListUsersResponse } from './types'

export const tailscaleListUsersTool: ToolConfig<TailscaleBaseParams, TailscaleListUsersResponse> = {
  id: 'tailscale_list_users',
  name: 'Tailscale List Users',
  description: 'List all users in the tailnet',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tailscale API key',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet name (e.g., example.com) or "-" for default',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/users`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { users: [], count: 0 },
        error: (data as Record<string, string>).message ?? 'Failed to list users',
      }
    }

    const data = await response.json()
    const users = (data.users ?? []).map((user: Record<string, unknown>) => ({
      id: (user.id as string) ?? null,
      displayName: (user.displayName as string) ?? null,
      loginName: (user.loginName as string) ?? null,
      profilePicURL: (user.profilePicURL as string) ?? null,
      role: (user.role as string) ?? null,
      status: (user.status as string) ?? null,
      type: (user.type as string) ?? null,
      created: (user.created as string) ?? null,
      lastSeen: (user.lastSeen as string) ?? null,
      deviceCount: (user.deviceCount as number) ?? 0,
    }))

    return {
      success: true,
      output: {
        users,
        count: users.length,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of users in the tailnet',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          displayName: { type: 'string', description: 'Display name' },
          loginName: { type: 'string', description: 'Login name / email' },
          profilePicURL: { type: 'string', description: 'Profile picture URL', optional: true },
          role: { type: 'string', description: 'User role (owner, admin, member, etc.)' },
          status: { type: 'string', description: 'User status (active, suspended, etc.)' },
          type: { type: 'string', description: 'User type (member, shared, tagged)' },
          created: { type: 'string', description: 'Creation timestamp' },
          lastSeen: { type: 'string', description: 'Last seen timestamp', optional: true },
          deviceCount: {
            type: 'number',
            description: 'Number of devices owned by user',
            optional: true,
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of users',
    },
  },
}
