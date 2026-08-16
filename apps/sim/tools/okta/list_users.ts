import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaListUsersParams, OktaListUsersResponse, OktaUser } from '@/tools/okta/types'
import { oktaHeaders, parseOktaPagination, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListUsers')

export const oktaListUsersTool: ToolConfig<OktaListUsersParams, OktaListUsersResponse> = {
  id: 'okta_list_users',
  name: 'List Users from Okta',
  description:
    'List users in your Okta organization with optional search and filtering. Users with a DEPROVISIONED status are omitted unless a search or filter expression selects them.',
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
        'Okta search expression (e.g., profile.firstName eq "John" or profile.email co "example.com")',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Okta filter expression (e.g., status eq "ACTIVE")',
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
      description: 'Maximum number of users to return per page (default: 200)',
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
        ? `https://${domain}/api/v1/users?${queryString}`
        : `https://${domain}/api/v1/users`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list users from Okta')
    }

    const { nextCursor, hasMore } = parseOktaPagination(response)
    const data: OktaUser[] = await response.json()

    const users = data.map((user) => ({
      id: user.id,
      status: user.status,
      firstName: user.profile?.firstName ?? null,
      lastName: user.profile?.lastName ?? null,
      email: user.profile?.email ?? null,
      login: user.profile?.login ?? null,
      mobilePhone: user.profile?.mobilePhone ?? null,
      title: user.profile?.title ?? null,
      department: user.profile?.department ?? null,
      created: user.created,
      lastLogin: user.lastLogin ?? null,
      lastUpdated: user.lastUpdated,
      activated: user.activated ?? null,
      statusChanged: user.statusChanged ?? null,
    }))

    return {
      success: true,
      output: {
        users,
        count: users.length,
        nextCursor,
        hasMore,
        success: true,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of Okta user objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          status: {
            type: 'string',
            description: 'User status (ACTIVE, STAGED, PROVISIONED, etc.)',
          },
          firstName: { type: 'string', description: 'First name', optional: true },
          lastName: { type: 'string', description: 'Last name', optional: true },
          email: { type: 'string', description: 'Email address', optional: true },
          login: { type: 'string', description: 'Login (usually email)', optional: true },
          mobilePhone: { type: 'string', description: 'Mobile phone', optional: true },
          title: { type: 'string', description: 'Job title', optional: true },
          department: { type: 'string', description: 'Department', optional: true },
          created: { type: 'string', description: 'Creation timestamp' },
          lastLogin: { type: 'string', description: 'Last login timestamp', optional: true },
          lastUpdated: { type: 'string', description: 'Last update timestamp' },
          activated: { type: 'string', description: 'Activation timestamp', optional: true },
          statusChanged: { type: 'string', description: 'Status change timestamp', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of users returned' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      optional: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more users are available' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
