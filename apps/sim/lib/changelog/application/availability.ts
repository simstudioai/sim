import { isChangelogEnabled } from '@/lib/changelog/feature-flag'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** permission-group-exempt: reports rollout availability only; changelog operations enforce files.use. */
const availabilityOperation = defineWorkspaceOperation({
  id: 'changelog.availability',
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

export const readChangelogAvailability = defineAuthorizedWorkspaceUseCase({
  operation: availabilityOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:workspaces', isWithinScope: () => true } },
  execute: ({ context }) => isChangelogEnabled(context.workspaceOrganizationId),
})
