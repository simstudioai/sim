import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaAppUser,
  OktaListAppUsersParams,
  OktaListAppUsersResponse,
} from '@/tools/okta/types'
import { oktaHeaders, parseOktaPagination, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaListAppUsers')

export const oktaListAppUsersTool: ToolConfig<OktaListAppUsersParams, OktaListAppUsersResponse> = {
  id: 'okta_list_app_users',
  name: 'List Application Users from Okta',
  description:
    'List the users assigned to an Okta application, including how each assignment was made and its provisioning sync state. Use this to audit who has access to an app.',
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
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application ID to list assigned users for',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search assigned users whose userName, firstName, lastName, or email starts with this value',
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
      description: 'Maximum number of assigned users to return (default: 50, max: 500)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.q) queryParams.append('q', params.q)
      if (params.after) queryParams.append('after', params.after)
      if (params.limit) queryParams.append('limit', params.limit.toString())

      const queryString = queryParams.toString()
      const base = `https://${domain}/api/v1/apps/${safeUrlPathSegment(params.appId, 'appId')}/users`
      return queryString ? `${base}?${queryString}` : base
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list application users from Okta')
    }

    const { nextCursor, hasMore } = parseOktaPagination(response)
    const data: OktaAppUser[] = await response.json()

    const appUsers = data.map((appUser) => ({
      id: appUser.id,
      externalId: appUser.externalId ?? null,
      created: appUser.created,
      lastUpdated: appUser.lastUpdated,
      scope: appUser.scope,
      status: appUser.status,
      statusChanged: appUser.statusChanged ?? null,
      passwordChanged: appUser.passwordChanged ?? null,
      syncState: appUser.syncState ?? null,
      lastSync: appUser.lastSync ?? null,
      userName: appUser.credentials?.userName ?? null,
      profile: appUser.profile ?? null,
    }))

    return {
      success: true,
      output: {
        appUsers,
        count: appUsers.length,
        nextCursor,
        hasMore,
        success: true,
      },
    }
  },

  outputs: {
    appUsers: {
      type: 'array',
      description: 'Array of application user assignments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Okta user ID' },
          externalId: {
            type: 'string',
            description: 'ID of the user in the downstream application',
            optional: true,
          },
          created: { type: 'string', description: 'Assignment creation timestamp' },
          lastUpdated: { type: 'string', description: 'Last update timestamp' },
          scope: {
            type: 'string',
            description: 'How the assignment was made: USER (direct) or GROUP (inherited)',
          },
          status: { type: 'string', description: 'Assignment status' },
          statusChanged: {
            type: 'string',
            description: 'Status change timestamp',
            optional: true,
          },
          passwordChanged: {
            type: 'string',
            description: 'App password change timestamp',
            optional: true,
          },
          syncState: { type: 'string', description: 'Provisioning sync state', optional: true },
          lastSync: { type: 'string', description: 'Last provisioning sync', optional: true },
          userName: {
            type: 'string',
            description: 'Username the user signs in to the application with',
            optional: true,
          },
          profile: {
            type: 'json',
            description: 'App-specific profile attributes, whose shape is set by the app schema',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of assignments returned' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      optional: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more assignments are available' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
