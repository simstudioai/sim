import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import {
  type CheckrListUsersParams,
  type CheckrListUsersResponse,
  LIST_META_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapListMeta,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListUsersTool: ToolConfig<CheckrListUsersParams, CheckrListUsersResponse> = {
  id: 'checkr_list_users',
  name: 'Checkr List Users',
  description: 'List the users on the Checkr account and their roles.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => checkrUrl('/users', checkrPaginationQuery(params)),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        users: toArray(data.data).map((value) => {
          const user = toRecord(value)
          return {
            id: toStringOrNull(user.id) ?? '',
            email: toStringOrNull(user.email),
            fullName: toStringOrNull(user.full_name),
            createdAt: toStringOrNull(user.created_at),
            roles: toArray(user.roles)
              .map((role) => toRecord(role).name)
              .filter((name): name is string => typeof name === 'string'),
          }
        }),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Users on the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          email: { type: 'string', description: 'Email address', nullable: true },
          fullName: { type: 'string', description: 'Full name', nullable: true },
          createdAt: { type: 'string', description: 'Time the user was created', nullable: true },
          roles: {
            type: 'array',
            description: 'Role names, e.g. admin',
            items: { type: 'string' },
          },
        },
      },
    },
    ...LIST_META_OUTPUTS,
  },
}
