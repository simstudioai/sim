import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaAppGroupAssignment,
  OktaListAppGroupsParams,
  OktaListAppGroupsResponse,
} from '@/tools/okta/types'
import { oktaHeaders, parseOktaPagination, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListAppGroups')

export const oktaListAppGroupsTool: ToolConfig<OktaListAppGroupsParams, OktaListAppGroupsResponse> =
  {
    id: 'okta_list_app_groups',
    name: 'List Application Groups from Okta',
    description:
      'List the groups assigned to an Okta application. Every member of an assigned group inherits access to the app, so this is the starting point for an app access review.',
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
        description: 'Application ID to list assigned groups for',
      },
      q: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Search assigned groups whose name starts with this value',
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
        description: 'Maximum number of assigned groups to return (default: 20, range: 20 to 200)',
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
        const base = `https://${domain}/api/v1/apps/${encodeURIComponent(params.appId.trim())}/groups`
        return queryString ? `${base}?${queryString}` : base
      },
      method: 'GET',
      headers: (params) => oktaHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        await throwOktaError(response, logger, 'Failed to list application groups from Okta')
      }

      const { nextCursor, hasMore } = parseOktaPagination(response)
      const data: OktaAppGroupAssignment[] = await response.json()

      const appGroups = data.map((assignment) => ({
        id: assignment.id,
        priority: assignment.priority ?? null,
        lastUpdated: assignment.lastUpdated,
        profile: assignment.profile ?? null,
      }))

      return {
        success: true,
        output: {
          appGroups,
          count: appGroups.length,
          nextCursor,
          hasMore,
          success: true,
        },
      }
    },

    outputs: {
      appGroups: {
        type: 'array',
        description: 'Array of application group assignments',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Assigned group ID' },
            priority: {
              type: 'number',
              description: 'Assignment priority, which resolves conflicting profile mappings',
              optional: true,
            },
            lastUpdated: { type: 'string', description: 'Last update timestamp' },
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
