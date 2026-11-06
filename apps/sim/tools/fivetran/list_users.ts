import {
  type FivetranListUsersParams,
  type FivetranListUsersResponse,
  NEXT_CURSOR_OUTPUT,
} from '@/tools/fivetran/types'
import {
  envelopePage,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_PAGINATION_PARAMS,
  fivetranHeaders,
  fivetranPaginationQuery,
  fivetranUrl,
  mapUser,
  optionalBoolean,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranListUsersTool: ToolConfig<FivetranListUsersParams, FivetranListUsersResponse> =
  {
    id: 'fivetran_list_users',
    name: 'Fivetran List Users',
    description:
      'List the users and service accounts in the Fivetran account with their role, status, and last login, for access reviews.',
    version: '1.0.0',
    errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
    oauth: FIVETRAN_OAUTH,

    params: {
      ...FIVETRAN_AUTH_PARAMS,
      active: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'true returns only enabled users, false only suspended ones; omit for both',
      },
      userType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return this type: REGULAR_USER or SERVICE_ACCOUNT',
      },
      hasApiKey: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return users with (true) or without (false) an API key',
      },
      ...FIVETRAN_PAGINATION_PARAMS,
    },

    request: {
      url: (params) =>
        fivetranUrl('/users', {
          active: optionalBoolean(params.active),
          user_type: trimmed(params.userType),
          has_api_key: optionalBoolean(params.hasApiKey),
          ...fivetranPaginationQuery(params),
        }),
      method: 'GET',
      headers: (params) => fivetranHeaders(params),
    },

    transformResponse: async (response: Response) => {
      const { items, nextCursor } = envelopePage(await response.json())
      return { success: true, output: { users: items.map(mapUser), nextCursor } }
    },

    outputs: {
      users: {
        type: 'array',
        description: 'Users',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            email: { type: 'string', description: 'Email address', nullable: true },
            givenName: { type: 'string', description: 'First name', nullable: true },
            familyName: { type: 'string', description: 'Last name', nullable: true },
            role: { type: 'string', description: 'Account role', nullable: true },
            active: {
              type: 'boolean',
              description: 'Whether the user can log in',
              nullable: true,
            },
            verified: {
              type: 'boolean',
              description: 'Whether the email address is verified',
              nullable: true,
            },
            invited: {
              type: 'boolean',
              description: 'Whether the user was invited',
              nullable: true,
            },
            userType: {
              type: 'string',
              description: 'REGULAR_USER or SERVICE_ACCOUNT',
              nullable: true,
            },
            hasApiKey: {
              type: 'boolean',
              description: 'Whether the user has an API key, including expired keys',
              nullable: true,
            },
            phone: { type: 'string', description: 'Phone number', nullable: true },
            loggedInAt: { type: 'string', description: 'Last login time', nullable: true },
            createdAt: { type: 'string', description: 'When the user was created', nullable: true },
          },
        },
      },
      ...NEXT_CURSOR_OUTPUT,
    },
  }
