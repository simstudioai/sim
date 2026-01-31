import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkListOrganizationsParams,
  ClerkListOrganizationsResponse,
  ClerkOrganization,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListOrganizations')

export const clerkListOrganizationsTool: ToolConfig<
  ClerkListOrganizationsParams,
  ClerkListOrganizationsResponse
> = {
  id: 'clerk_list_organizations',
  name: 'List Organizations from Clerk',
  description: 'List all organizations in your Clerk application with optional filtering',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 50, 100; range: 1-500, default: 10)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination (e.g., 0, 10, 20)',
    },
    includeMembersCount: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include member count for each organization',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search by organization ID, name, or slug (e.g., Acme Corp or acme-corp)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (name, created_at, members_count) with +/- prefix',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())
      if (params.includeMembersCount) queryParams.append('include_members_count', 'true')
      if (params.query) queryParams.append('query', params.query)
      if (params.orderBy) queryParams.append('order_by', params.orderBy)

      const queryString = queryParams.toString()
      return queryString
        ? `https://api.clerk.com/v1/organizations?${queryString}`
        : 'https://api.clerk.com/v1/organizations'
    },
    method: 'GET',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const json: { data: ClerkOrganization[]; total_count: number } | ClerkApiError =
      await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data: json, status: response.status })
      throw new Error(
        (json as ClerkApiError).errors?.[0]?.message || 'Failed to list organizations from Clerk'
      )
    }

    const responseData = json as { data: ClerkOrganization[]; total_count: number }

    // Transform each organization to extract key fields
    const organizations = responseData.data.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug ?? null,
      imageUrl: org.image_url ?? null,
      hasImage: org.has_image ?? false,
      membersCount: org.members_count ?? null,
      pendingInvitationsCount: org.pending_invitations_count ?? null,
      maxAllowedMemberships: org.max_allowed_memberships ?? 0,
      adminDeleteEnabled: org.admin_delete_enabled ?? false,
      createdBy: org.created_by ?? null,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
      publicMetadata: org.public_metadata ?? {},
    }))

    return {
      success: true,
      output: {
        organizations,
        totalCount: responseData.total_count ?? organizations.length,
        success: true,
      },
    }
  },

  outputs: {
    organizations: {
      type: 'array',
      description: 'Array of Clerk organization objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Organization ID' },
          name: { type: 'string', description: 'Organization name' },
          slug: { type: 'string', description: 'Organization slug', optional: true },
          imageUrl: { type: 'string', description: 'Organization image URL', optional: true },
          hasImage: { type: 'boolean', description: 'Whether organization has an image' },
          membersCount: { type: 'number', description: 'Number of members', optional: true },
          pendingInvitationsCount: {
            type: 'number',
            description: 'Number of pending invitations',
            optional: true,
          },
          maxAllowedMemberships: { type: 'number', description: 'Max allowed memberships' },
          adminDeleteEnabled: { type: 'boolean', description: 'Whether admin delete is enabled' },
          createdBy: { type: 'string', description: 'Creator user ID', optional: true },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
          publicMetadata: { type: 'json', description: 'Public metadata' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of organizations' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
