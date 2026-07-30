import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkCreateOrganizationInvitationParams,
  ClerkCreateOrganizationInvitationResponse,
  ClerkOrganizationInvitation,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkCreateOrganizationInvitation')

export const clerkCreateOrganizationInvitationTool: ToolConfig<
  ClerkCreateOrganizationInvitationParams,
  ClerkCreateOrganizationInvitationResponse
> = {
  id: 'clerk_create_organization_invitation',
  name: 'Create Organization Invitation in Clerk',
  description: 'Invite a user by email to join a Clerk organization with a given role',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the user to invite',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Role to assign on acceptance, e.g. org:admin or org:member',
    },
    inviterUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the inviter',
    },
    redirectUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to redirect to after the invitation is accepted',
    },
    expiresInDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Days until the invitation expires (1-365, default 30)',
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
    notify: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether Clerk sends the invitation email (default true)',
    },
  },

  request: {
    url: (params) =>
      `https://api.clerk.com/v1/organizations/${params.organizationId?.trim()}/invitations`,
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
        email_address: params.emailAddress,
        role: params.role,
      }

      if (params.inviterUserId !== undefined) body.inviter_user_id = params.inviterUserId
      if (params.redirectUrl !== undefined) body.redirect_url = params.redirectUrl
      if (params.expiresInDays !== undefined) body.expires_in_days = params.expiresInDays
      if (params.publicMetadata !== undefined) body.public_metadata = params.publicMetadata
      if (params.privateMetadata !== undefined) body.private_metadata = params.privateMetadata
      if (params.notify !== undefined) body.notify = params.notify

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkOrganizationInvitation | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to create organization invitation in Clerk'
      )
    }

    const invitation = data as ClerkOrganizationInvitation
    return {
      success: true,
      output: {
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
        success: true,
      },
    }
  },

  outputs: {
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
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
