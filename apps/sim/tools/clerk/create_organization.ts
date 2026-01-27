import { createLogger } from '@sim/logger'
import type {
  ClerkCreateOrganizationParams,
  ClerkCreateOrganizationResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkCreateOrganization')

export const clerkCreateOrganizationTool: ToolConfig<
  ClerkCreateOrganizationParams,
  ClerkCreateOrganizationResponse
> = {
  id: 'clerk_create_organization',
  name: 'Create Organization in Clerk',
  description: 'Create a new organization in your Clerk application',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the organization',
    },
    createdBy: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID of the creator (will become admin)',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slug identifier for the organization',
    },
    maxAllowedMemberships: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum member capacity (0 for unlimited)',
    },
    publicMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public metadata (JSON object)',
    },
    privateMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private metadata (JSON object)',
    },
  },

  request: {
    url: () => 'https://api.clerk.com/v1/organizations',
    method: 'POST',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        created_by: params.createdBy,
      }

      if (params.slug) body.slug = params.slug
      if (params.maxAllowedMemberships !== undefined)
        body.max_allowed_memberships = params.maxAllowedMemberships
      if (params.publicMetadata) body.public_metadata = params.publicMetadata
      if (params.privateMetadata) body.private_metadata = params.privateMetadata

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(data.errors?.[0]?.message || 'Failed to create organization in Clerk')
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
    id: { type: 'string', description: 'Created organization ID' },
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
