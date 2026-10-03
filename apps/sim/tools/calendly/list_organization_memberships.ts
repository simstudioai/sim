import type {
  CalendlyListOrganizationMembershipsParams,
  CalendlyListOrganizationMembershipsResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const listOrganizationMembershipsTool: ToolConfig<
  CalendlyListOrganizationMembershipsParams,
  CalendlyListOrganizationMembershipsResponse
> = {
  id: 'calendly_list_organization_memberships',
  name: 'Calendly List Organization Memberships',
  description: 'Retrieve the members of an organization, including each member profile and role',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    organization: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return memberships that belong to this organization. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/organizations/abc123-def456")',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return memberships that belong to this user. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/users/abc123-def456")',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter memberships by member email address',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by role. Format: "owner", "admin", or "user"',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page. Format: integer (default: 20, max: 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page token for pagination. Format: opaque string from previous response next_page_token',
    },
  },

  request: {
    url: (params: CalendlyListOrganizationMembershipsParams) => {
      const url = 'https://api.calendly.com/organization_memberships'
      const queryParams = []

      if (!params.user && !params.organization) {
        throw new Error(
          'At least one of "user" or "organization" parameter is required. Please provide either a user URI or organization URI.'
        )
      }

      if (params.organization) {
        queryParams.push(
          `organization=${encodeURIComponent(toResourceUri(params.organization, 'organizations'))}`
        )
      }

      if (params.user) {
        queryParams.push(`user=${encodeURIComponent(toResourceUri(params.user, 'users'))}`)
      }

      if (params.email) {
        queryParams.push(`email=${encodeURIComponent(params.email)}`)
      }

      if (params.role) {
        queryParams.push(`role=${encodeURIComponent(params.role)}`)
      }

      if (params.count) {
        queryParams.push(`count=${Number(params.count)}`)
      }

      if (params.pageToken) {
        queryParams.push(`page_token=${encodeURIComponent(params.pageToken)}`)
      }

      return `${url}?${queryParams.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    collection: {
      type: 'array',
      description: 'Array of organization membership objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the membership' },
          role: { type: 'string', description: 'Member role (owner, admin, or user)' },
          organization: { type: 'string', description: 'URI of the organization' },
          created_at: { type: 'string', description: 'ISO timestamp when the member joined' },
          updated_at: { type: 'string', description: 'ISO timestamp when the membership changed' },
          user: {
            type: 'object',
            description: 'The member',
            properties: {
              uri: { type: 'string', description: 'Canonical reference to the user' },
              name: { type: 'string', description: 'User full name' },
              slug: { type: 'string', description: 'Unique identifier for the user in URLs' },
              email: { type: 'string', description: 'User email address' },
              scheduling_url: { type: 'string', description: "URL to the user's scheduling page" },
              timezone: { type: 'string', description: 'User timezone' },
              time_notation: {
                type: 'string',
                description: 'Time notation preference (12h or 24h)',
              },
              avatar_url: { type: 'string', description: 'URL to user avatar image' },
              locale: { type: 'string', description: 'User locale' },
              created_at: { type: 'string', description: 'ISO timestamp when user was created' },
              updated_at: { type: 'string', description: 'ISO timestamp when user was updated' },
            },
          },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        count: { type: 'number', description: 'Number of results in this page' },
        next_page: { type: 'string', description: 'URL to next page (if available)' },
        previous_page: { type: 'string', description: 'URL to previous page (if available)' },
        next_page_token: { type: 'string', description: 'Token for next page' },
        previous_page_token: { type: 'string', description: 'Token for previous page' },
      },
    },
  },
}
