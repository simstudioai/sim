import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2CreateWorkspaceInvitationsContract } from '@/lib/api/contracts/v2/workspace-invitations'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { invitationOperations } from '@/lib/invitations/application/operations'

export const workspaceInvitationOpenApiRoutes = [
  defineOpenApiRoute(
    v2CreateWorkspaceInvitationsContract,
    {
      applicationOperation: invitationOperations.sendBatch,
      operationId: 'createWorkspaceInvitations',
      summary: 'Create Workspace Invitations',
      description: `Invite people to a workspace or grant access immediately to existing organization members. Requires workspace administrator access and current invitation eligibility; organization administrator invitations also require organization administrator access. Recipients are processed independently: inspect failed even after HTTP 200, and inspect invitation status before retrying a delivery failure. Existing access is preserved. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspaces'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Per-recipient invitation and direct-grant outcomes.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateWorkspaceInvitationsContract.params,
        'CreateWorkspaceInvitationsParams',
        'Create Workspace Invitations parameters',
        'Target workspace.'
      ),
      query: v2CreateWorkspaceInvitationsContract.query,
      body: documentedSchema(
        v2CreateWorkspaceInvitationsContract.body,
        'CreateWorkspaceInvitationsBody',
        'Create Workspace Invitations body',
        'Recipients and the access to grant.',
        [{ emails: ['member@example.com'], permission: 'write', membership: 'member' }]
      ),
      response: documentedSchema(
        v2CreateWorkspaceInvitationsContract.response.schema,
        'CreateWorkspaceInvitationsResponse',
        'Create Workspace Invitations response',
        'Successful recipients remain committed when later recipients fail.',
        [
          {
            data: {
              success: true,
              successful: ['member@example.com'],
              added: [],
              failed: [],
              invitations: [
                {
                  id: 'invitation-123',
                  email: 'member@example.com',
                  workspaceIds: ['workspace-123'],
                  permission: 'write',
                  membershipIntent: 'internal',
                },
              ],
            },
          },
        ]
      ),
    }
  ),
] as const
