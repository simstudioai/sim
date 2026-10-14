import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2CreateOrganizationInvitationContract,
  v2GetOrganizationContract,
  v2GetOrganizationInvitationContract,
  v2ListOrganizationInvitationsContract,
  v2ListOrganizationInvitationWorkspacesContract,
  v2ListOrganizationMembersContract,
  v2ListOrganizationsContract,
  v2ListOrganizationWorkspacesContract,
  v2RemoveOrganizationMemberContract,
  v2ResendOrganizationInvitationContract,
  v2RevokeOrganizationInvitationContract,
  v2UpdateOrganizationMemberContract,
} from '@/lib/api/contracts/v2/organizations'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { invitationOperations } from '@/lib/invitations/application/operations'
import { organizationOperations } from '@/lib/organizations/application/operations'

const TIMESTAMP = '2026-06-01T09:00:00.000Z'

export const organizationOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListOrganizationsContract,
    {
      applicationOperation: organizationOperations.list,
      operationId: 'listOrganizations',
      summary: 'List organizations',
      description: `List organizations the acting user belongs to. Organizations that disallow the calling credential are omitted. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of organizations and the acting user’s role in each.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      query: documentedSchema(
        v2ListOrganizationsContract.query,
        'ListOrganizationsQuery',
        'List organizations query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationsContract.response.schema,
        'ListOrganizationsResponse',
        'List organizations response',
        'A page of organizations and the acting user’s role in each.',
        [
          {
            data: [
              {
                id: 'org-123',
                name: 'Example Organization',
                slug: 'example',
                logo: null,
                role: 'admin',
                createdAt: TIMESTAMP,
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetOrganizationContract,
    {
      applicationOperation: organizationOperations.read,
      operationId: 'getOrganization',
      summary: 'Get organization',
      description: `Get organization metadata and the acting user’s organization role. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Organization metadata and the acting user’s role.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationContract.params,
        'GetOrganizationParams',
        'Get organization parameters',
        'Organization identifier.'
      ),
      query: v2GetOrganizationContract.query,
      response: documentedSchema(
        v2GetOrganizationContract.response.schema,
        'GetOrganizationResponse',
        'Get organization response',
        'Organization metadata and the acting user’s role.',
        [
          {
            data: {
              id: 'org-123',
              name: 'Example Organization',
              slug: 'example',
              logo: null,
              role: 'admin',
              createdAt: TIMESTAMP,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationWorkspacesContract,
    {
      applicationOperation: organizationOperations.listWorkspaces,
      operationId: 'listOrganizationWorkspaces',
      summary: 'List organization workspaces',
      description: `List active workspaces owned by the organization. Requires organization Admin access; does not require Access Control. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of active workspaces owned by the organization.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationWorkspacesContract.params,
        'ListOrganizationWorkspacesParams',
        'List organization workspaces parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListOrganizationWorkspacesContract.query,
        'ListOrganizationWorkspacesQuery',
        'List organization workspaces query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationWorkspacesContract.response.schema,
        'ListOrganizationWorkspacesResponse',
        'List organization workspaces response',
        'A page of active workspaces owned by the organization.',
        [{ data: [{ id: 'workspace-123', name: 'Engineering' }], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationMembersContract,
    {
      applicationOperation: organizationOperations.listMembers,
      operationId: 'listOrganizationMembers',
      summary: 'List organization members',
      description: `List organization members by name or email. Ordinary members must have access to the member directory; organization administrators retain access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of organization members and their organization roles.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationMembersContract.params,
        'ListOrganizationMembersParams',
        'List organization members parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListOrganizationMembersContract.query,
        'ListOrganizationMembersQuery',
        'List organization members query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationMembersContract.response.schema,
        'ListOrganizationMembersResponse',
        'List organization members response',
        'A page of organization members and their organization roles.',
        [
          {
            data: [
              {
                userId: 'user-123',
                name: 'Example Member',
                email: 'member@example.com',
                role: 'member',
                joinedAt: TIMESTAMP,
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateOrganizationMemberContract,
    {
      applicationOperation: organizationOperations.updateMember,
      operationId: 'updateOrganizationMember',
      summary: 'Update organization member',
      description: `Change a member’s organization role. Requires organization Admin access. The owner’s role and memberships managed by an identity provider cannot be changed here. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The member with the updated organization role.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateOrganizationMemberContract.params,
        'UpdateOrganizationMemberParams',
        'Update organization member parameters',
        'Organization and resource identifiers.'
      ),
      query: v2UpdateOrganizationMemberContract.query,
      body: documentedSchema(
        v2UpdateOrganizationMemberContract.body,
        'UpdateOrganizationMemberBody',
        'Update organization member body',
        'The new organization role for this member.',
        [{ role: 'admin' }]
      ),
      response: documentedSchema(
        v2UpdateOrganizationMemberContract.response.schema,
        'UpdateOrganizationMemberResponse',
        'Update organization member response',
        'The member with the updated organization role.',
        [
          {
            data: {
              userId: 'user-123',
              name: 'Example Member',
              email: 'member@example.com',
              role: 'admin',
              joinedAt: TIMESTAMP,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RemoveOrganizationMemberContract,
    {
      applicationOperation: organizationOperations.removeMember,
      operationId: 'removeOrganizationMember',
      summary: 'Remove organization member',
      description: `Remove a member and revoke their access to organization workspaces. Administrators may remove members; members may remove themselves. The organization owner cannot be removed. Owned organization resources are reassigned and the departing member’s sessions end. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Acknowledgement that organization access was removed.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RemoveOrganizationMemberContract.params,
        'RemoveOrganizationMemberParams',
        'Remove organization member parameters',
        'Organization and resource identifiers.'
      ),
      query: v2RemoveOrganizationMemberContract.query,
      response: documentedSchema(
        v2RemoveOrganizationMemberContract.response.schema,
        'RemoveOrganizationMemberResponse',
        'Remove organization member response',
        'Acknowledgement that organization access was removed.',
        [{ data: { userId: 'user-123', deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationInvitationsContract,
    {
      applicationOperation: organizationOperations.listInvitations,
      operationId: 'listOrganizationInvitations',
      summary: 'List organization invitations',
      description: `List invitations owned by the organization, including invitations with workspace grants. Requires organization Admin access. Expired invitations are reported without modifying them. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of invitations, including their current status.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationInvitationsContract.params,
        'ListOrganizationInvitationsParams',
        'List organization invitations parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListOrganizationInvitationsContract.query,
        'ListOrganizationInvitationsQuery',
        'List organization invitations query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationInvitationsContract.response.schema,
        'ListOrganizationInvitationsResponse',
        'List organization invitations response',
        'A page of invitations, including their current status.',
        [
          {
            data: [
              {
                id: 'invitation-123',
                organizationId: 'org-123',
                email: 'member@example.com',
                role: 'member',
                kind: 'organization',
                membershipIntent: 'internal',
                status: 'pending',
                createdAt: TIMESTAMP,
                expiresAt: '2026-06-08T09:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateOrganizationInvitationContract,
    {
      applicationOperation: organizationOperations.createInvitation,
      operationId: 'createOrganizationInvitation',
      summary: 'Create organization invitation',
      description: `Email an invitation to join the organization as a member or Admin. Requires organization Admin access and invitations enabled; an eligible plan and available seat are required when billing is enabled. It grants no workspace-specific permissions. Existing organization membership or an unexpired pending invitation for the email returns \`409\`. Use Resend organization invitation to send a pending invitation again. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The pending organization invitation.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateOrganizationInvitationContract.params,
        'CreateOrganizationInvitationParams',
        'Create organization invitation parameters',
        'Organization identifier.'
      ),
      query: v2CreateOrganizationInvitationContract.query,
      body: documentedSchema(
        v2CreateOrganizationInvitationContract.body,
        'CreateOrganizationInvitationBody',
        'Create organization invitation body',
        'Invitee email and organization role to offer.',
        [{ email: 'member@example.com', role: 'member' }]
      ),
      response: documentedSchema(
        v2CreateOrganizationInvitationContract.response.schema,
        'CreateOrganizationInvitationResponse',
        'Create organization invitation response',
        'The pending organization invitation.',
        [
          {
            data: {
              id: 'invitation-123',
              organizationId: 'org-123',
              email: 'member@example.com',
              role: 'member',
              kind: 'organization',
              membershipIntent: 'internal',
              status: 'pending',
              createdAt: TIMESTAMP,
              expiresAt: '2026-06-08T09:00:00.000Z',
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetOrganizationInvitationContract,
    {
      applicationOperation: organizationOperations.readInvitation,
      operationId: 'getOrganizationInvitation',
      summary: 'Get organization invitation',
      description: `Get an invitation owned by the organization. Requires organization Admin access. Use List organization invitation workspaces to inspect its workspace grants. The response excludes the acceptance token. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Invitation metadata without its acceptance token.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationInvitationContract.params,
        'GetOrganizationInvitationParams',
        'Get organization invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2GetOrganizationInvitationContract.query,
      response: documentedSchema(
        v2GetOrganizationInvitationContract.response.schema,
        'GetOrganizationInvitationResponse',
        'Get organization invitation response',
        'Invitation metadata without its acceptance token.',
        [
          {
            data: {
              id: 'invitation-123',
              organizationId: 'org-123',
              email: 'member@example.com',
              role: 'member',
              kind: 'organization',
              membershipIntent: 'internal',
              status: 'pending',
              createdAt: TIMESTAMP,
              expiresAt: '2026-06-08T09:00:00.000Z',
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationInvitationWorkspacesContract,
    {
      applicationOperation: organizationOperations.listInvitationWorkspaces,
      operationId: 'listOrganizationInvitationWorkspaces',
      summary: 'List organization invitation workspaces',
      description: `List workspace grants attached to an invitation of any status. Includes archived workspaces still owned by the organization; workspaces moved to another organization are omitted. Requires organization Admin access. These grants describe the invitation, not the invitee's current access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of workspace grants attached to the invitation.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationInvitationWorkspacesContract.params,
        'ListOrganizationInvitationWorkspacesParams',
        'List organization invitation workspaces parameters',
        'Organization and invitation identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationInvitationWorkspacesContract.query,
        'ListOrganizationInvitationWorkspacesQuery',
        'List organization invitation workspaces query',
        'Filtering, sorting, and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationInvitationWorkspacesContract.response.schema,
        'ListOrganizationInvitationWorkspacesResponse',
        'List organization invitation workspaces response',
        'Workspace grants retained on an invitation.',
        [
          {
            data: [
              { id: 'workspace-123', name: 'Engineering', permission: 'write', archivedAt: null },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ResendOrganizationInvitationContract,
    {
      applicationOperation: invitationOperations.resend,
      operationId: 'resendOrganizationInvitation',
      summary: 'Resend organization invitation',
      description: `Email an unexpired pending invitation again, renew its expiry, and replace its previous acceptance link. Requires organization Admin access and current invitation eligibility. Retrying sends another email; inspect the invitation after a delivery failure before retrying. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The pending invitation with its renewed expiry.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ResendOrganizationInvitationContract.params,
        'ResendOrganizationInvitationParams',
        'Resend organization invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2ResendOrganizationInvitationContract.query,
      body: documentedSchema(
        v2ResendOrganizationInvitationContract.body,
        'ResendOrganizationInvitationBody',
        'Resend organization invitation body',
        'An empty JSON object; the pending invitation supplies the recipient and role.',
        [{}]
      ),
      response: documentedSchema(
        v2ResendOrganizationInvitationContract.response.schema,
        'ResendOrganizationInvitationResponse',
        'Resend organization invitation response',
        'The pending invitation with its renewed expiry.',
        [
          {
            data: {
              id: 'invitation-123',
              organizationId: 'org-123',
              email: 'member@example.com',
              role: 'member',
              kind: 'organization',
              membershipIntent: 'internal',
              status: 'pending',
              createdAt: TIMESTAMP,
              expiresAt: '2026-06-08T09:00:00.000Z',
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RevokeOrganizationInvitationContract,
    {
      applicationOperation: invitationOperations.revoke,
      operationId: 'revokeOrganizationInvitation',
      summary: 'Revoke organization invitation',
      description: `Cancel an unexpired pending invitation and all its workspace grants so it can no longer be accepted. Requires organization Admin access. This does not remove a person who already accepted; use Remove organization member for that. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Acknowledgement that the pending invitation was cancelled.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RevokeOrganizationInvitationContract.params,
        'RevokeOrganizationInvitationParams',
        'Revoke organization invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2RevokeOrganizationInvitationContract.query,
      response: documentedSchema(
        v2RevokeOrganizationInvitationContract.response.schema,
        'RevokeOrganizationInvitationResponse',
        'Revoke organization invitation response',
        'Acknowledgement that the pending invitation was cancelled.',
        [{ data: { id: 'invitation-123', status: 'cancelled' } }]
      ),
    }
  ),
] as const
