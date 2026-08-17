import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaGroup, OktaListGroupsParams, OktaListGroupsResponse } from '@/tools/okta/types'
import { oktaHeaders, parseOktaPagination, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListGroups')

export const oktaListGroupsTool: ToolConfig<OktaListGroupsParams, OktaListGroupsResponse> = {
  id: 'okta_list_groups',
  name: 'List Groups from Okta',
  description: 'List all groups in your Okta organization with optional search and filtering',
  version: '1.0.0',

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
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Okta search expression for groups (e.g., profile.name sw "Engineering" or type eq "OKTA_GROUP")',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Okta filter expression (e.g., type eq "OKTA_GROUP")',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor returned as nextCursor by a previous call',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of groups to return per page (max: 10000)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.search) queryParams.append('search', params.search)
      if (params.filter) queryParams.append('filter', params.filter)
      if (params.after) queryParams.append('after', params.after)
      if (params.limit) queryParams.append('limit', params.limit.toString())

      const queryString = queryParams.toString()
      return queryString
        ? `https://${domain}/api/v1/groups?${queryString}`
        : `https://${domain}/api/v1/groups`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list groups from Okta')
    }

    const { nextCursor, hasMore } = parseOktaPagination(response)
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
        nextCursor,
        hasMore,
        success: true,
      },
    }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'Array of Okta group objects',
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
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      optional: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more groups are available' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
