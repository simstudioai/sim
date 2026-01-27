import { createLogger } from '@sim/logger'
import type { ClerkGetOrganizationParams, ClerkGetOrganizationResponse } from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkGetOrganization')

export const clerkGetOrganizationTool: ToolConfig<
  ClerkGetOrganizationParams,
  ClerkGetOrganizationResponse
> = {
  id: 'clerk_get_organization',
  name: 'Get Organization from Clerk',
  description: 'Retrieve a single organization by ID or slug from Clerk',
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
      description: 'The ID or slug of the organization to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/organizations/${params.organizationId}`,
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
    const data = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(data.errors?.[0]?.message || 'Failed to get organization from Clerk')
    }

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        slug: data.slug ?? null,
        imageUrl: data.image_url ?? null,
        hasImage: data.has_image ?? false,
        membersCount: data.members_count ?? null,
        pendingInvitationsCount: data.pending_invitations_count ?? null,
        maxAllowedMemberships: data.max_allowed_memberships ?? 0,
        adminDeleteEnabled: data.admin_delete_enabled ?? false,
        createdBy: data.created_by ?? null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        publicMetadata: data.public_metadata ?? {},
        success: true,
      },
    }
  },

  outputs: {
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
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
