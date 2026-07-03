import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkListOrganizationMembershipsParams,
  ClerkListOrganizationMembershipsResponse,
  ClerkOrganizationMembership,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListOrganizationMemberships')

export const clerkListOrganizationMembershipsTool: ToolConfig<
  ClerkListOrganizationMembershipsParams,
  ClerkListOrganizationMembershipsResponse
> = {
  id: 'clerk_list_organization_memberships',
  name: 'List Organization Memberships from Clerk',
  description: 'List members of a Clerk organization with optional filtering and pagination',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the organization (e.g., org_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
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
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (e.g., created_at) with +/- prefix for direction',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by role, comma-separated for multiple (e.g., org:admin,org:member)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.role) {
        params.role.split(',').forEach((role) => {
          queryParams.append('role', role.trim())
        })
      }

      const queryString = queryParams.toString()
      const base = `https://api.clerk.com/v1/organizations/${params.organizationId?.trim()}/memberships`
      return queryString ? `${base}?${queryString}` : base
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
    const json: { data: ClerkOrganizationMembership[]; total_count: number } | ClerkApiError =
      await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data: json, status: response.status })
      throw new Error(
        (json as ClerkApiError).errors?.[0]?.message ||
          'Failed to list organization memberships from Clerk'
      )
    }

    const responseData = json as { data: ClerkOrganizationMembership[]; total_count: number }

    const memberships = responseData.data.map((membership) => ({
      id: membership.id,
      role: membership.role,
      roleName: membership.role_name ?? null,
      permissions: membership.permissions ?? [],
      organizationId: membership.organization.id,
      userId: membership.public_user_data.user_id,
      firstName: membership.public_user_data.first_name ?? null,
      lastName: membership.public_user_data.last_name ?? null,
      imageUrl: membership.public_user_data.image_url ?? null,
      identifier: membership.public_user_data.identifier ?? null,
      username: membership.public_user_data.username ?? null,
      banned: membership.public_user_data.banned ?? false,
      publicMetadata: membership.public_metadata ?? {},
      createdAt: membership.created_at,
      updatedAt: membership.updated_at,
    }))

    return {
      success: true,
      output: {
        memberships,
        totalCount: responseData.total_count ?? memberships.length,
        success: true,
      },
    }
  },

  outputs: {
    memberships: {
      type: 'array',
      description: 'Array of Clerk organization membership objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Membership ID' },
          role: { type: 'string', description: 'Member role' },
          roleName: { type: 'string', description: 'Human-readable role name', optional: true },
          permissions: {
            type: 'array',
            description: 'Permissions granted by the role',
            items: { type: 'string' },
          },
          organizationId: { type: 'string', description: 'Organization ID' },
          userId: { type: 'string', description: 'Member user ID' },
          firstName: { type: 'string', description: 'Member first name', optional: true },
          lastName: { type: 'string', description: 'Member last name', optional: true },
          imageUrl: { type: 'string', description: 'Member profile image URL', optional: true },
          identifier: {
            type: 'string',
            description: 'Member identifier (e.g., email)',
            optional: true,
          },
          username: { type: 'string', description: 'Member username', optional: true },
          banned: { type: 'boolean', description: 'Whether the member is banned' },
          publicMetadata: { type: 'json', description: 'Public metadata' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of memberships' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
