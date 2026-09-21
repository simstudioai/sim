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
      summary: 'List Organizations',
      description: `List organizations the acting user belongs to. Organizations that disallow the calling credential are omitted. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: { description: 'List Organizations result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      query: documentedSchema(
        v2ListOrganizationsContract.query,
        'ListOrganizationsQuery',
        'List Organizations query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationsContract.response.schema,
        'ListOrganizationsResponse',
        'List Organizations response',
        'List Organizations result.',
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
      summary: 'Get Organization',
      description: `Get organization metadata and the acting user’s organization role. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: { description: 'Get Organization result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetOrganizationContract.params,
        'GetOrganizationParams',
        'Get Organization parameters',
        'Organization and resource identifiers.'
      ),
      query: v2GetOrganizationContract.query,
      response: documentedSchema(
        v2GetOrganizationContract.response.schema,
        'GetOrganizationResponse',
        'Get Organization response',
        'Get Organization result.',
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
      summary: 'List Organization Workspaces',
      description: `List active workspaces owned by the organization. Requires organization administrator access; does not require Access Control. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: { description: 'List Organization Workspaces result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListOrganizationWorkspacesContract.params,
        'ListOrganizationWorkspacesParams',
        'List Organization Workspaces parameters',
        'Organization and resource identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationWorkspacesContract.query,
        'ListOrganizationWorkspacesQuery',
        'List Organization Workspaces query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationWorkspacesContract.response.schema,
        'ListOrganizationWorkspacesResponse',
        'List Organization Workspaces response',
        'List Organization Workspaces result.',
        [{ data: [{ id: 'workspace-123', name: 'Engineering' }], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationMembersContract,
    {
      applicationOperation: organizationOperations.listMembers,
      operationId: 'listOrganizationMembers',
      summary: 'List Organization Members',
      description: `List organization members by name or email. Ordinary members must have access to the member directory; organization administrators retain access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: { description: 'List Organization Members result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListOrganizationMembersContract.params,
        'ListOrganizationMembersParams',
        'List Organization Members parameters',
        'Organization and resource identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationMembersContract.query,
        'ListOrganizationMembersQuery',
        'List Organization Members query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationMembersContract.response.schema,
        'ListOrganizationMembersResponse',
        'List Organization Members response',
        'List Organization Members result.',
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
      summary: 'Update Organization Member',
      description: `Change a member’s organization role. Requires organization administrator access. The owner’s role and memberships managed by an identity provider cannot be changed here. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Update Organization Member result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2UpdateOrganizationMemberContract.params,
        'UpdateOrganizationMemberParams',
        'Update Organization Member parameters',
        'Organization and resource identifiers.'
      ),
      query: v2UpdateOrganizationMemberContract.query,
      body: documentedSchema(
        v2UpdateOrganizationMemberContract.body,
        'UpdateOrganizationMemberBody',
        'Update Organization Member body',
        'Update Organization Member input.',
        [{ role: 'admin' }]
      ),
      response: documentedSchema(
        v2UpdateOrganizationMemberContract.response.schema,
        'UpdateOrganizationMemberResponse',
        'Update Organization Member response',
        'Update Organization Member result.',
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
      summary: 'Remove Organization Member',
      description: `Remove a member and revoke their access to organization workspaces. Administrators may remove members; members may remove themselves. The organization owner cannot be removed. Owned organization resources are reassigned and the departing member’s sessions end. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Remove Organization Member result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2RemoveOrganizationMemberContract.params,
        'RemoveOrganizationMemberParams',
        'Remove Organization Member parameters',
        'Organization and resource identifiers.'
      ),
      query: v2RemoveOrganizationMemberContract.query,
      response: documentedSchema(
        v2RemoveOrganizationMemberContract.response.schema,
        'RemoveOrganizationMemberResponse',
        'Remove Organization Member response',
        'Remove Organization Member result.',
        [{ data: { userId: 'user-123', deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationInvitationsContract,
    {
      applicationOperation: organizationOperations.listInvitations,
      operationId: 'listOrganizationInvitations',
      summary: 'List Organization Invitations',
      description: `List invitations owned by the organization, including invitations with workspace grants. Requires organization administrator access. Expired invitations are reported without modifying them. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'List Organization Invitations result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationInvitationsContract.params,
        'ListOrganizationInvitationsParams',
        'List Organization Invitations parameters',
        'Organization and resource identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationInvitationsContract.query,
        'ListOrganizationInvitationsQuery',
        'List Organization Invitations query',
        'Filtering and pagination controls.'
      ),
      response: documentedSchema(
        v2ListOrganizationInvitationsContract.response.schema,
        'ListOrganizationInvitationsResponse',
        'List Organization Invitations response',
        'List Organization Invitations result.',
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
      summary: 'Create Organization Invitation',
      description: `Email an invitation to join the organization as a member or administrator. Requires organization administrator access, invitations enabled, and an available seat on an eligible plan. This grants no workspace-specific permissions. A unexpired pending invitation for the email conflicts; use Resend Organization Invitation to send it again. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Create Organization Invitation result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateOrganizationInvitationContract.params,
        'CreateOrganizationInvitationParams',
        'Create Organization Invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2CreateOrganizationInvitationContract.query,
      body: documentedSchema(
        v2CreateOrganizationInvitationContract.body,
        'CreateOrganizationInvitationBody',
        'Create Organization Invitation body',
        'Create Organization Invitation input.',
        [{ email: 'member@example.com', role: 'member' }]
      ),
      response: documentedSchema(
        v2CreateOrganizationInvitationContract.response.schema,
        'CreateOrganizationInvitationResponse',
        'Create Organization Invitation response',
        'Create Organization Invitation result.',
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
      summary: 'Get Organization Invitation',
      description: `Get an invitation owned by the organization. Requires organization administrator access. The response excludes the acceptance token. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: { description: 'Get Organization Invitation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetOrganizationInvitationContract.params,
        'GetOrganizationInvitationParams',
        'Get Organization Invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2GetOrganizationInvitationContract.query,
      response: documentedSchema(
        v2GetOrganizationInvitationContract.response.schema,
        'GetOrganizationInvitationResponse',
        'Get Organization Invitation response',
        'Get Organization Invitation result.',
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
    v2ResendOrganizationInvitationContract,
    {
      applicationOperation: invitationOperations.resend,
      operationId: 'resendOrganizationInvitation',
      summary: 'Resend Organization Invitation',
      description: `Email a unexpired pending invitation again, renew its expiry, and replace its previous acceptance link. Requires organization administrator access and current invitation eligibility. Retrying sends another email; inspect the invitation after a delivery failure before retrying. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Resend Organization Invitation result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ResendOrganizationInvitationContract.params,
        'ResendOrganizationInvitationParams',
        'Resend Organization Invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2ResendOrganizationInvitationContract.query,
      body: documentedSchema(
        v2ResendOrganizationInvitationContract.body,
        'ResendOrganizationInvitationBody',
        'Resend Organization Invitation body',
        'Resend Organization Invitation input.',
        [{}]
      ),
      response: documentedSchema(
        v2ResendOrganizationInvitationContract.response.schema,
        'ResendOrganizationInvitationResponse',
        'Resend Organization Invitation response',
        'Resend Organization Invitation result.',
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
      summary: 'Revoke Organization Invitation',
      description: `Cancel a unexpired pending invitation and all its workspace grants so it can no longer be accepted. Requires organization administrator access. This does not remove a person who already accepted; use Remove Organization Member for that. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Revoke Organization Invitation result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RevokeOrganizationInvitationContract.params,
        'RevokeOrganizationInvitationParams',
        'Revoke Organization Invitation parameters',
        'Organization and resource identifiers.'
      ),
      query: v2RevokeOrganizationInvitationContract.query,
      response: documentedSchema(
        v2RevokeOrganizationInvitationContract.response.schema,
        'RevokeOrganizationInvitationResponse',
        'Revoke Organization Invitation response',
        'Revoke Organization Invitation result.',
        [{ data: { id: 'invitation-123', status: 'cancelled' } }]
      ),
    }
  ),
] as const
