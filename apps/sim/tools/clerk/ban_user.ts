import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkBanUserParams,
  ClerkBanUserResponse,
  ClerkUser,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkBanUser')

export const clerkBanUserTool: ToolConfig<ClerkBanUserParams, ClerkBanUserResponse> = {
  id: 'clerk_ban_user',
  name: 'Ban User in Clerk',
  description: 'Ban a user, preventing them from signing in',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user to ban (e.g., user_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/users/${params.userId?.trim()}/ban`,
    method: 'POST',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkUser | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error((data as ClerkApiError).errors?.[0]?.message || 'Failed to ban user in Clerk')
    }

    const user = data as ClerkUser
    return {
      success: true,
      output: {
        id: user.id,
        username: user.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        banned: user.banned ?? false,
        locked: user.locked ?? false,
        lockoutExpiresInSeconds: user.lockout_expires_in_seconds ?? null,
        updatedAt: user.updated_at,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    username: { type: 'string', description: 'Username', optional: true },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    banned: { type: 'boolean', description: 'Whether the user is banned' },
    locked: { type: 'boolean', description: 'Whether the user is locked' },
    lockoutExpiresInSeconds: {
      type: 'number',
      description: 'Seconds until lockout expires',
      optional: true,
    },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
