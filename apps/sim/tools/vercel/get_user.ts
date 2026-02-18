import type { ToolConfig } from '@/tools/types'
import type { VercelGetUserParams, VercelGetUserResponse } from '@/tools/vercel/types'

export const vercelGetUserTool: ToolConfig<VercelGetUserParams, VercelGetUserResponse> = {
  id: 'vercel_get_user',
  name: 'Vercel Get User',
  description: 'Get information about the authenticated Vercel user',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
  },

  request: {
    url: () => 'https://api.vercel.com/v2/user',
    method: 'GET',
    headers: (params: VercelGetUserParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const d = data.user ?? data

    return {
      success: true,
      output: {
        id: d.id ?? null,
        email: d.email ?? null,
        username: d.username ?? null,
        name: d.name ?? null,
        avatar: d.avatar ?? null,
        defaultTeamId: d.defaultTeamId ?? null,
        createdAt: d.createdAt ?? null,
        stagingPrefix: d.stagingPrefix ?? null,
        softBlock: d.softBlock
          ? {
              blockedAt: d.softBlock.blockedAt ?? null,
              reason: d.softBlock.reason ?? null,
            }
          : null,
        hasTrialAvailable: d.hasTrialAvailable ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    email: { type: 'string', description: 'User email' },
    username: { type: 'string', description: 'Username' },
    name: { type: 'string', description: 'Display name' },
    avatar: { type: 'string', description: 'SHA1 hash of the avatar' },
    defaultTeamId: { type: 'string', description: 'Default team ID' },
    createdAt: { type: 'number', description: 'Account creation timestamp in milliseconds' },
    stagingPrefix: { type: 'string', description: 'Prefix for preview deployment URLs' },
    softBlock: {
      type: 'object',
      description: 'Account restriction details if blocked',
      properties: {
        blockedAt: { type: 'number', description: 'When the account was blocked' },
        reason: { type: 'string', description: 'Reason for the block' },
      },
    },
    hasTrialAvailable: { type: 'boolean', description: 'Whether a trial is available' },
  },
}
