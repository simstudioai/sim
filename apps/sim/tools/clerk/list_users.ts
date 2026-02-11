import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkEmailAddress,
  ClerkListUsersParams,
  ClerkListUsersResponse,
  ClerkPhoneNumber,
  ClerkUser,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListUsers')

export const clerkListUsersTool: ToolConfig<ClerkListUsersParams, ClerkListUsersResponse> = {
  id: 'clerk_list_users',
  name: 'List Users from Clerk',
  description: 'List all users in your Clerk application with optional filtering and pagination',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 50, 100; range: 1-500, default: 10)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination (e.g., 0, 10, 20)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field with optional +/- prefix for direction (default: -created_at)',
    },
    emailAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by email address (e.g., user@example.com or user1@example.com,user2@example.com)',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by phone number (comma-separated for multiple)',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by external ID (comma-separated for multiple)',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by username (comma-separated for multiple)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by user ID (e.g., user_2NNEqL2nrIRdJ194ndJqAHwEfxC or comma-separated for multiple)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to match across email, phone, username, and names (e.g., john or john@example.com)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.query) queryParams.append('query', params.query)

      // Handle comma-separated array params
      if (params.emailAddress) {
        params.emailAddress.split(',').forEach((email) => {
          queryParams.append('email_address', email.trim())
        })
      }
      if (params.phoneNumber) {
        params.phoneNumber.split(',').forEach((phone) => {
          queryParams.append('phone_number', phone.trim())
        })
      }
      if (params.externalId) {
        params.externalId.split(',').forEach((id) => {
          queryParams.append('external_id', id.trim())
        })
      }
      if (params.username) {
        params.username.split(',').forEach((uname) => {
          queryParams.append('username', uname.trim())
        })
      }
      if (params.userId) {
        params.userId.split(',').forEach((id) => {
          queryParams.append('user_id', id.trim())
        })
      }

      const queryString = queryParams.toString()
      return queryString
        ? `https://api.clerk.com/v1/users?${queryString}`
        : 'https://api.clerk.com/v1/users'
    },
    method: 'GET',
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
    const data: ClerkUser[] | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to list users from Clerk'
      )
    }

    // The response is an array of users, total_count is in the header
    const totalCount = Number.parseInt(response.headers.get('x-total-count') || '0', 10)

    // Transform each user to extract key fields
    const users = (data as ClerkUser[]).map((user) => ({
      id: user.id,
      username: user.username ?? null,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
      imageUrl: user.image_url ?? null,
      hasImage: user.has_image ?? false,
      primaryEmailAddressId: user.primary_email_address_id ?? null,
      primaryPhoneNumberId: user.primary_phone_number_id ?? null,
      emailAddresses: (user.email_addresses ?? []).map((email: ClerkEmailAddress) => ({
        id: email.id,
        emailAddress: email.email_address,
      })),
      phoneNumbers: (user.phone_numbers ?? []).map((phone: ClerkPhoneNumber) => ({
        id: phone.id,
        phoneNumber: phone.phone_number,
      })),
      externalId: user.external_id ?? null,
      passwordEnabled: user.password_enabled ?? false,
      twoFactorEnabled: user.two_factor_enabled ?? false,
      banned: user.banned ?? false,
      locked: user.locked ?? false,
      lastSignInAt: user.last_sign_in_at ?? null,
      lastActiveAt: user.last_active_at ?? null,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      publicMetadata: user.public_metadata ?? {},
    }))

    return {
      success: true,
      output: {
        users,
        totalCount: totalCount || users.length,
        success: true,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of Clerk user objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          username: { type: 'string', description: 'Username', optional: true },
          firstName: { type: 'string', description: 'First name', optional: true },
          lastName: { type: 'string', description: 'Last name', optional: true },
          imageUrl: { type: 'string', description: 'Profile image URL', optional: true },
          hasImage: { type: 'boolean', description: 'Whether user has a profile image' },
          primaryEmailAddressId: {
            type: 'string',
            description: 'Primary email address ID',
            optional: true,
          },
          primaryPhoneNumberId: {
            type: 'string',
            description: 'Primary phone number ID',
            optional: true,
          },
          emailAddresses: {
            type: 'array',
            description: 'User email addresses',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Email address ID' },
                emailAddress: { type: 'string', description: 'Email address' },
              },
            },
          },
          phoneNumbers: {
            type: 'array',
            description: 'User phone numbers',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Phone number ID' },
                phoneNumber: { type: 'string', description: 'Phone number' },
              },
            },
          },
          externalId: { type: 'string', description: 'External system ID', optional: true },
          passwordEnabled: { type: 'boolean', description: 'Whether password is enabled' },
          twoFactorEnabled: { type: 'boolean', description: 'Whether 2FA is enabled' },
          banned: { type: 'boolean', description: 'Whether user is banned' },
          locked: { type: 'boolean', description: 'Whether user is locked' },
          lastSignInAt: { type: 'number', description: 'Last sign-in timestamp', optional: true },
          lastActiveAt: { type: 'number', description: 'Last activity timestamp', optional: true },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
          publicMetadata: { type: 'json', description: 'Public metadata' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of users matching the query' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
