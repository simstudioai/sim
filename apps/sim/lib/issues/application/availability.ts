import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { isIssuesEnabled } from '@/lib/issues/feature-flag'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** permission-group-exempt: reports rollout availability only; issue operations enforce files.use. */
const availabilityOperation = defineWorkspaceOperation({
  id: 'issues.availability',
  minimumRole: 'read',
  oauthScope: 'api:read',
  workspaceApiKey: 'allow',
  capability: 'none',
  principalKinds: [
    'session',
    'personal_api_key',
    'workspace_api_key',
    'oauth_access_token',
    'delegated',
  ],
  delegatedServices: ['copilot'],
})

export const readIssueAvailability = defineAuthorizedWorkspaceUseCase({
  operation: availabilityOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:workspaces', isWithinScope: () => true } },
  execute: ({ context }) => isIssuesEnabled(context.workspaceOrganizationId),
})
