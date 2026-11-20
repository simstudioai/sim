import {
  defineAuthorizedWorkspaceUseCase,
  defineWorkspaceOperation,
  isOperationFeatureEnabled,
} from '@/lib/core/application'
import { WORKFLOW_CODE_FEATURE } from '@/lib/workflows/code/feature-flag'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** permission-group-exempt: reports rollout availability only; source operations enforce their own policies. */
const availabilityOperation = defineWorkspaceOperation({
  id: 'workflow_code.availability',
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

/**
 * Whether workflows as code is rolled out where the caller works in a workspace: the same
 * predicate every source use case enforces, so a chat is told of the source commands exactly
 * when they would run.
 */
export const readWorkflowCodeAvailability = defineAuthorizedWorkspaceUseCase({
  operation: availabilityOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:workspaces', isWithinScope: () => true } },
  execute: ({ principal, context }) =>
    isOperationFeatureEnabled(WORKFLOW_CODE_FEATURE, principal, context),
})
