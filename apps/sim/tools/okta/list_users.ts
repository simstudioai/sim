import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaListUsersParams,
  OktaListUsersResponse,
  OktaUser,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListUsers')

export const oktaListUsersTool: ToolConfig<OktaListUsersParams, OktaListUsersResponse> = {
  id: 'okta_list_users',
  name: 'List Users from Okta',
  description: 'List all users in your Okta organization with optional search and filtering',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (default: 200, max: 200)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.search) queryParams.append('search', params.search)
      if (params.filter) queryParams.append('filter', params.filter)
      if (params.limit) queryParams.append('limit', params.limit.toString())

      const queryString = queryParams.toString()
      return queryString
        ? `https://${domain}/api/v1/users?${queryString}`
        : `https://${domain}/api/v1/users`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let error: OktaApiError = {}
      try {
        error = await response.json()
      } catch {
        // non-JSON error body
      }
      logger.error('Okta API request failed', { data: error, status: response.status })
      throw new Error(error.errorSummary || 'Failed to list users from Okta')
    }

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
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
