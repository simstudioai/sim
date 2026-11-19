import { isBuildNotesEnabled } from '@/lib/build-notes/feature-flag'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** permission-group-exempt: reports rollout availability only; each build-notes operation enforces its own role. */
const availabilityOperation = defineWorkspaceOperation({
  id: 'workflows.build_notes.availability',
  minimumRole: 'read',
  oauthScope: 'api:read',
  workspaceApiKey: 'allow',
  capability: 'none',
  contentDelivery: 'none',
  principalKinds: [
    'session',
    'personal_api_key',
    'workspace_api_key',
    'oauth_access_token',
    'delegated',
  ],
  delegatedServices: ['copilot'],
})

export const readBuildNotesAvailability = defineAuthorizedWorkspaceUseCase({
  operation: availabilityOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:workspaces', isWithinScope: () => true } },
  execute: ({ context }) => isBuildNotesEnabled(context.workspaceOrganizationId),
})
