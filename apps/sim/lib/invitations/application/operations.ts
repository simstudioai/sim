import { defineOperation } from '@/lib/core/application/operation'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const invitationOperations = {
  sendBatch: defineOperation({
    id: 'invitations.send_batch',
    capability: 'invitations.send',
    principalKinds: ['session'],
  }),
  resend: defineOperation({
    id: 'invitations.resend',
    capability: 'invitations.send',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: withdrawing access remains available when sending invitations is disabled.
   */
  revoke: defineOperation({
    id: 'invitations.revoke',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:write',
  }),
} as const

/** Authority branches are fixed; invitation admission capabilities are checked after authority. */
export const invitationAuthorityOperations = {
  /**
   * permission-group-exempt: resend checks the admission organization and every grant; revoke needs no send capability.
   */
  organization: defineOrganizationOperation({
    id: 'invitations.organization.authorize',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: this session-only branch checks authority; resend separately checks every admission scope.
   */
  workspace: defineWorkspaceOperation({
    id: 'invitations.workspace.authorize',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const
