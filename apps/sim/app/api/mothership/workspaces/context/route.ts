import { readWorkspaceContextContract } from '@/lib/api/contracts/mothership-workspaces'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  readWorkspaceContext,
  readWorkspaceContextOperation,
} from '@/lib/mothership/chat/application/workspace-context'
import { WORKSPACE_TARGET_AUDIENCE } from '@/lib/mothership/chat/application/workspace-target'

export const POST = defineInternalJsonRoute({
  contract: readWorkspaceContextContract,
  auth: internalCopilotAuth(WORKSPACE_TARGET_AUDIENCE, { organization: true }),
  operation: readWorkspaceContextOperation,
  rateLimit: internalRateLimits.none({
    reason:
      'Private worker preflight rechecks the current workspace grant before local memory access.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readWorkspaceContext,
})
