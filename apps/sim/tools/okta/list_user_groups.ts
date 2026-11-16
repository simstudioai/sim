import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaGroup,
  OktaListUserGroupsParams,
  OktaListUserGroupsResponse,
} from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import { OKTA_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaListUserGroups')

export const oktaListUserGroupsTool: ToolConfig<
  OktaListUserGroupsParams,
  OktaListUserGroupsResponse
> = {
  id: 'okta_list_user_groups',
  name: 'List User Groups from Okta',
  description:
    'List every group a user is a member of. Use it for access reviews and offboarding instead of scanning the members of each group.',
  version: '1.0.0',
  oauth: OKTA_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID or login whose groups to list',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/users/${safeUrlPathSegment(params.userId, 'userId')}/groups`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list user groups from Okta')
    }

    const data: OktaGroup[] = await response.json()

    const groups = data.map((group) => ({
      id: group.id,
      name: group.profile?.name ?? '',
      description: group.profile?.description ?? null,
      type: group.type,
      created: group.created,
      lastUpdated: group.lastUpdated,
      lastMembershipUpdated: group.lastMembershipUpdated ?? null,
    }))

    return {
      success: true,
      output: {
        groups,
        count: groups.length,
        success: true,
      },
    }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'Array of groups the user belongs to',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Group ID' },
          name: { type: 'string', description: 'Group name' },
          description: { type: 'string', description: 'Group description', optional: true },
          type: { type: 'string', description: 'Group type (OKTA_GROUP, APP_GROUP, BUILT_IN)' },
          created: { type: 'string', description: 'Creation timestamp' },
          lastUpdated: { type: 'string', description: 'Last update timestamp' },
          lastMembershipUpdated: {
            type: 'string',
            description: 'Last membership change timestamp',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of groups returned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
