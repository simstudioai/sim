import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkOrganizationMembership,
  ClerkRemoveOrganizationMemberParams,
  ClerkRemoveOrganizationMemberResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkRemoveOrganizationMember')

export const clerkRemoveOrganizationMemberTool: ToolConfig<
  ClerkRemoveOrganizationMemberParams,
  ClerkRemoveOrganizationMemberResponse
> = {
  id: 'clerk_remove_organization_member',
  name: 'Remove Organization Member from Clerk',
  description: 'Remove a member from a Clerk organization',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the member to remove',
    },
  },

  request: {
    url: (params) =>
      `https://api.clerk.com/v1/organizations/${params.organizationId?.trim()}/memberships/${params.userId?.trim()}`,
    method: 'DELETE',
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
    const data: ClerkOrganizationMembership | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to remove organization member from Clerk'
      )
    }

    const membership = data as ClerkOrganizationMembership
    return {
      success: true,
      output: {
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
        success: true,
      },
    }
  },

  outputs: {
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
    identifier: { type: 'string', description: 'Member identifier (e.g., email)', optional: true },
    username: { type: 'string', description: 'Member username', optional: true },
    banned: { type: 'boolean', description: 'Whether the member is banned' },
    publicMetadata: { type: 'json', description: 'Public metadata' },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
