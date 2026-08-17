import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaApplication, OktaListAppsParams, OktaListAppsResponse } from '@/tools/okta/types'
import {
  isOktaFlagEnabled,
  oktaHeaders,
  parseOktaPagination,
  throwOktaError,
} from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListApps')

export const oktaListAppsTool: ToolConfig<OktaListAppsParams, OktaListAppsResponse> = {
  id: 'okta_list_apps',
  name: 'List Applications from Okta',
  description:
    'List the applications configured in your Okta organization, with optional name search, filtering, and cursor pagination.',
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
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search for applications whose name or label starts with this value',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Okta filter expression (e.g., status eq "ACTIVE")',
    },
    includeNonDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Also return inactive applications. Deleted applications stay excluded either way (default: false)',
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
      description: 'Maximum number of applications to return (max: 200)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.q) queryParams.append('q', params.q)
      if (params.filter) queryParams.append('filter', params.filter)
      if (params.includeNonDeleted !== undefined) {
        queryParams.append('includeNonDeleted', String(isOktaFlagEnabled(params.includeNonDeleted)))
      }
      if (params.after) queryParams.append('after', params.after)
      if (params.limit) queryParams.append('limit', params.limit.toString())

      const queryString = queryParams.toString()
      return queryString
        ? `https://${domain}/api/v1/apps?${queryString}`
        : `https://${domain}/api/v1/apps`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list applications from Okta')
    }

    const { nextCursor, hasMore } = parseOktaPagination(response)
    const data: OktaApplication[] = await response.json()

    const apps = data.map((app) => ({
      id: app.id,
      name: app.name,
      label: app.label,
      status: app.status,
      signOnMode: app.signOnMode,
      features: app.features ?? [],
      created: app.created,
      lastUpdated: app.lastUpdated,
    }))

    return {
      success: true,
      output: {
        apps,
        count: apps.length,
        nextCursor,
        hasMore,
        success: true,
      },
    }
  },

  outputs: {
    apps: {
      type: 'array',
      description: 'Array of Okta applications',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Application ID' },
          name: { type: 'string', description: 'Application name (the app template key)' },
          label: { type: 'string', description: 'Application display label' },
          status: { type: 'string', description: 'Application status (ACTIVE, INACTIVE, DELETED)' },
          signOnMode: {
            type: 'string',
            description: 'Sign-on mode (SAML_2_0, OPENID_CONNECT, BOOKMARK, etc.)',
          },
          features: {
            type: 'array',
            description: 'Enabled provisioning features',
            items: { type: 'string', description: 'Feature name' },
          },
          created: { type: 'string', description: 'Creation timestamp' },
          lastUpdated: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Number of applications returned' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      optional: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more applications are available' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
