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
  v2GetSearchSourcePermissionsContract,
  v2ListOrganizationInvitationsContract,
  v2ListOrganizationInvitationWorkspacesContract,
  v2ListOrganizationMembersContract,
  v2ListOrganizationsContract,
  v2ListOrganizationWorkspacesContract,
  v2RemoveOrganizationMemberContract,
  v2ReplaceSearchSourcePermissionsContract,
  v2ResendOrganizationInvitationContract,
  v2RevokeOrganizationInvitationContract,
  v2UpdateOrganizationMemberContract,
} from '@/lib/api/contracts/v2/organizations'
import {
  v2CreateSearchSourceContract,
  v2DeleteSearchSourceContract,
  v2GetSearchSourceContract,
  v2ListSearchSourcesContract,
  v2PrepareSearchSourcesContract,
  v2UpdateSearchSourceContract,
} from '@/lib/api/contracts/v2/search-sources'
import {
  v2CompleteSourcePermissionImportContract,
  v2CreateSourcePermissionImportContract,
  v2PutSourcePermissionImportPartContract,
} from '@/lib/api/contracts/v2/source-permission-imports'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { invitationOperations } from '@/lib/invitations/application/operations'
import {
  knowledgeOperations,
  searchSourceOperations,
  searchSourcePermissionOperations,
} from '@/lib/knowledge/application/operations'
import { organizationOperations } from '@/lib/organizations/application/operations'

const TIMESTAMP = '2026-06-01T09:00:00.000Z'

const searchSourcePermissionParams = documentedSchema(
  v2GetSearchSourcePermissionsContract.params,
  'SearchSourcePermissionParams',
  'Search source permission parameters',
  'Organization and Search source identifiers.'
)
const searchSourcePermissionResponse = documentedSchema(
  v2GetSearchSourcePermissionsContract.response.schema,
  'SearchSourcePermissionResponse',
  'Search source permission response',
  'Current revision of the source permission grants.',
  [{ data: { revision: 3 } }]
)

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
  defineOpenApiRoute(
    v2GetSearchSourcePermissionsContract,
    {
      applicationOperation: searchSourcePermissionOperations.read,
      operationId: 'getSearchSourcePermissions',
      summary: 'Get Search source permission revision',
      description: `Read the permission revision for a Search source that accepts externally managed grants. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_ERRORS,
      success: { description: 'The current permission revision.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: searchSourcePermissionParams,
      query: v2GetSearchSourcePermissionsContract.query,
      response: searchSourcePermissionResponse,
    }
  ),
  defineOpenApiRoute(
    v2ReplaceSearchSourcePermissionsContract,
    {
      applicationOperation: searchSourcePermissionOperations.replace,
      operationId: 'replaceSearchSourcePermissions',
      summary: 'Replace Search source permissions',
      description: `Replace the complete permission grants for one Search source. Requires organization Admin access. Supply the current revision and the grants for the configured provider. A stale revision returns 409. GitLab CSV mode accepts both files together, up to 8 MiB and 500,000 data rows each, within a 10 MiB limit for the complete JSON-encoded request. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The new permission revision.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: searchSourcePermissionParams,
      query: v2ReplaceSearchSourcePermissionsContract.query,
      body: documentedSchema(
        v2ReplaceSearchSourcePermissionsContract.body,
        'ReplaceSearchSourcePermissionsBody',
        'Search source permission grants',
        'The expected revision and complete replacement grants for the provider.',
        [
          {
            expectedRevision: 2,
            permissions: {
              provider: 'gitlab',
              userMapping: {
                filename: 'users.csv',
                content: 'user_id,email\n42,reader@example.com\n',
              },
              projectPermissions: {
                filename: 'projects.csv',
                content: 'project_path,user_id\nteam/project,42\n',
              },
            },
          },
        ]
      ),
      response: searchSourcePermissionResponse,
    }
  ),

  defineOpenApiRoute(
    v2CreateSourcePermissionImportContract,
    {
      applicationOperation: searchSourcePermissionOperations.replace,
      operationId: 'createSourcePermissionImport',
      summary: 'Create source permission import',
      description:
        'Stage a complete permission snapshot without changing active access. Upload numbered CSV parts, then complete the import within 24 hours using the same credential. Requires organization Admin access. Existing inline uploads remain supported.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Permission import result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CreateSourcePermissionImportContract.params,
        'CreateSourcePermissionImportParams',
        'Create source permission import parameters',
        'Organization, source and import identifiers.'
      ),
      query: v2CreateSourcePermissionImportContract.query,
      body: documentedSchema(
        v2CreateSourcePermissionImportContract.body,
        'CreateSourcePermissionImportBody',
        'Create source permission import',
        'Permission import input.'
      ),
      response: documentedSchema(
        v2CreateSourcePermissionImportContract.response.schema,
        'CreateSourcePermissionImportResponse',
        'Create source permission import response',
        'Permission import result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PutSourcePermissionImportPartContract,
    {
      applicationOperation: searchSourcePermissionOperations.replace,
      operationId: 'putSourcePermissionImportPart',
      summary: 'Upload source permission import part',
      description:
        'Upload one CSV part in order, with all user-mapping parts before project-permission parts. Each part supports 5,000 data rows and 1 MiB of UTF-8 content. An identical retry is safe; changed or out-of-order parts conflict.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Permission import result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2PutSourcePermissionImportPartContract.params,
        'PutSourcePermissionImportParams',
        'Upload source permission import part parameters',
        'Organization, source and import identifiers.'
      ),
      query: v2PutSourcePermissionImportPartContract.query,
      body: documentedSchema(
        v2PutSourcePermissionImportPartContract.body,
        'PutSourcePermissionImportBody',
        'Upload source permission import part',
        'Permission import input.'
      ),
      response: documentedSchema(
        v2PutSourcePermissionImportPartContract.response.schema,
        'PutSourcePermissionImportResponse',
        'Upload source permission import part response',
        'Permission import result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CompleteSourcePermissionImportContract,
    {
      applicationOperation: searchSourcePermissionOperations.replace,
      operationId: 'completeSourcePermissionImport',
      summary: 'Complete source permission import',
      description:
        'Validate and activate a complete permission snapshot atomically. The source revision must still match the revision pinned before export. Incomplete, expired, or invalid imports preserve current access. Retrying a completed import returns its committed revision.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Permission import result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CompleteSourcePermissionImportContract.params,
        'CompleteSourcePermissionImportParams',
        'Complete source permission import parameters',
        'Organization, source and import identifiers.'
      ),
      query: v2CompleteSourcePermissionImportContract.query,
      body: documentedSchema(
        v2CompleteSourcePermissionImportContract.body,
        'CompleteSourcePermissionImportBody',
        'Complete source permission import',
        'Permission import input.'
      ),
      response: documentedSchema(
        v2CompleteSourcePermissionImportContract.response.schema,
        'CompleteSourcePermissionImportResponse',
        'Complete source permission import response',
        'Permission import result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PrepareSearchSourcesContract,
    {
      applicationOperation: knowledgeOperations.prepareSearchSource,
      operationId: 'prepareSearchSources',
      summary: 'Prepare Search sources',
      description:
        'Idempotently initialize shared Search configuration before creating a source. Does not create a connector or change existing sources. Organization admin required.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Source operation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2PrepareSearchSourcesContract.params,
        'PrepareSearchSourcesParams',
        'Prepare Search sources parameters',
        'Organization and source identifiers.'
      ),
      query: v2PrepareSearchSourcesContract.query,
      body: documentedSchema(
        v2PrepareSearchSourcesContract.body,
        'PrepareSearchSourcesBody',
        'Prepare Search sources input',
        'Source configuration.'
      ),
      response: documentedSchema(
        v2PrepareSearchSourcesContract.response.schema,
        'PrepareSearchSourcesResponse',
        'Prepare Search sources response',
        'Source operation result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSearchSourcesContract,
    {
      applicationOperation: searchSourceOperations.list,
      operationId: 'listSearchSources',
      summary: 'List Search sources',
      description:
        'List source IDs and administrative configuration with cursor pagination. Organization admin required. Credentials and CSV contents are never returned.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Source operation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListSearchSourcesContract.params,
        'ListSearchSourcesParams',
        'List Search sources parameters',
        'Organization and source identifiers.'
      ),
      query: documentedSchema(
        v2ListSearchSourcesContract.query,
        'ListSearchSourcesQuery',
        'List Search sources query',
        'Pagination and ordering.'
      ),
      response: documentedSchema(
        v2ListSearchSourcesContract.response.schema,
        'ListSearchSourcesResponse',
        'List Search sources response',
        'Source operation result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSearchSourceContract,
    {
      applicationOperation: searchSourceOperations.read,
      operationId: 'getSearchSource',
      summary: 'Get Search source',
      description:
        'Read source configuration and permission revision summaries. Organization admin required.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Source operation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetSearchSourceContract.params,
        'GetSearchSourceParams',
        'Get Search source parameters',
        'Organization and source identifiers.'
      ),
      query: v2GetSearchSourceContract.query,
      response: documentedSchema(
        v2GetSearchSourceContract.response.schema,
        'GetSearchSourceResponse',
        'Get Search source response',
        'Source operation result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateSearchSourceContract,
    {
      applicationOperation: searchSourceOperations.create,
      operationId: 'createSearchSource',
      summary: 'Create Search source',
      description:
        'Create a source in the prepared organization Search index using the same provider validation as Settings. Use connector-types list for provider configuration. This does not override an explicit integration approval decision. Organization admin required.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Source operation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CreateSearchSourceContract.params,
        'CreateSearchSourceParams',
        'Create Search source parameters',
        'Organization and source identifiers.'
      ),
      query: v2CreateSearchSourceContract.query,
      body: documentedSchema(
        v2CreateSearchSourceContract.body,
        'CreateSearchSourceBody',
        'Create Search source input',
        'Source configuration.'
      ),
      response: documentedSchema(
        v2CreateSearchSourceContract.response.schema,
        'CreateSearchSourceResponse',
        'Create Search source response',
        'Source operation result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateSearchSourceContract,
    {
      applicationOperation: searchSourceOperations.update,
      operationId: 'updateSearchSource',
      summary: 'Update Search source',
      description:
        'Update source selection, supported provider credentials, or permission settings; pause or resume a source. Omitted fields are retained. sourceConfig replaces the complete configuration. GitLab token rotation retains saved grants and advances the permission revision; supply permissionConfig with the current expectedRevision for rotation or CSV updates. Organization admin required.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Source operation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2UpdateSearchSourceContract.params,
        'UpdateSearchSourceParams',
        'Update Search source parameters',
        'Organization and source identifiers.'
      ),
      query: v2UpdateSearchSourceContract.query,
      body: documentedSchema(
        v2UpdateSearchSourceContract.body,
        'UpdateSearchSourceBody',
        'Update Search source input',
        'Source configuration.'
      ),
      response: documentedSchema(
        v2UpdateSearchSourceContract.response.schema,
        'UpdateSearchSourceResponse',
        'Update Search source response',
        'Source operation result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteSearchSourceContract,
    {
      applicationOperation: searchSourceOperations.delete,
      operationId: 'deleteSearchSource',
      summary: 'Delete Search source',
      description:
        'Remove a source and its associated permission grants. Cleanup is asynchronous. Organization admin required.',
      tags: ['Organizations'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Source operation result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2DeleteSearchSourceContract.params,
        'DeleteSearchSourceParams',
        'Delete Search source parameters',
        'Organization and source identifiers.'
      ),
      query: v2DeleteSearchSourceContract.query,
      response: documentedSchema(
        v2DeleteSearchSourceContract.response.schema,
        'DeleteSearchSourceResponse',
        'Delete Search source response',
        'Source operation result.'
      ),
    }
  ),
] as const
