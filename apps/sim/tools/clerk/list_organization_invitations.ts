import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkListOrganizationInvitationsParams,
  ClerkListOrganizationInvitationsResponse,
  ClerkOrganizationInvitation,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListOrganizationInvitations')

export const clerkListOrganizationInvitationsTool: ToolConfig<
  ClerkListOrganizationInvitationsParams,
  ClerkListOrganizationInvitationsResponse
> = {
  id: 'clerk_list_organization_invitations',
  name: 'List Organization Invitations from Clerk',
  description: 'List pending and past invitations for a Clerk organization',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status: pending, accepted, revoked, or expired',
    },
    emailAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by invited email address',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (created_at, email_address) with +/- prefix (default: -created_at)',
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
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.status) queryParams.append('status', params.status)
      if (params.emailAddress) queryParams.append('email_address', params.emailAddress)
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())

      const queryString = queryParams.toString()
      const base = `https://api.clerk.com/v1/organizations/${params.organizationId?.trim()}/invitations`
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
    const json: { data: ClerkOrganizationInvitation[]; total_count: number } | ClerkApiError =
      await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data: json, status: response.status })
      throw new Error(
        (json as ClerkApiError).errors?.[0]?.message ||
          'Failed to list organization invitations from Clerk'
      )
    }

    const responseData = json as { data: ClerkOrganizationInvitation[]; total_count: number }

    const invitations = responseData.data.map((invitation) => ({
      id: invitation.id,
      emailAddress: invitation.email_address,
      role: invitation.role,
      roleName: invitation.role_name ?? null,
      organizationId: invitation.organization_id,
      inviterId: invitation.inviter_id ?? null,
      inviterEmail: invitation.public_inviter_data?.identifier ?? null,
      inviterFirstName: invitation.public_inviter_data?.first_name ?? null,
      inviterLastName: invitation.public_inviter_data?.last_name ?? null,
      status: invitation.status,
      url: invitation.url ?? null,
      expiresAt: invitation.expires_at ?? null,
      publicMetadata: invitation.public_metadata ?? {},
      createdAt: invitation.created_at,
      updatedAt: invitation.updated_at,
    }))

    return {
      success: true,
      output: {
        invitations,
        totalCount: responseData.total_count ?? invitations.length,
        success: true,
      },
    }
  },

  outputs: {
    invitations: {
      type: 'array',
      description: 'Array of Clerk organization invitation objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Invitation ID' },
          emailAddress: { type: 'string', description: 'Invited email address' },
          role: { type: 'string', description: 'Role to assign on acceptance' },
          roleName: { type: 'string', description: 'Human-readable role name', optional: true },
          organizationId: { type: 'string', description: 'Organization ID' },
          inviterId: { type: 'string', description: 'User ID of the inviter', optional: true },
          inviterEmail: { type: 'string', description: "Inviter's email address", optional: true },
          inviterFirstName: { type: 'string', description: "Inviter's first name", optional: true },
          inviterLastName: { type: 'string', description: "Inviter's last name", optional: true },
          status: { type: 'string', description: 'Invitation status' },
          url: { type: 'string', description: 'Invitation URL', optional: true },
          expiresAt: { type: 'number', description: 'Expiration timestamp', optional: true },
          publicMetadata: { type: 'json', description: 'Public metadata' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of invitations' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
