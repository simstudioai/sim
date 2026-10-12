import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** permission-group-exempt: reports rollout availability only; test operations enforce files.use. */
const availabilityOperation = defineWorkspaceOperation({
  id: 'workflow_tests.availability',
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

export const readWorkflowTestAvailability = defineAuthorizedWorkspaceUseCase({
  operation: availabilityOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:workspaces', isWithinScope: () => true } },
  execute: ({ context }) => isWorkflowTestsEnabled(context.workspaceOrganizationId),
})
