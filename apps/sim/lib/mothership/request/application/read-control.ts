import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream, isRunStopRequested } from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { RunControlRequest } from '@/lib/mothership/generated/run-control'

export const RUN_CONTROL_AUDIENCE = 'sim:copilot-run-control'
// permission-group-exempt: observing stop state must remain possible after Copilot access is withheld
export const readRunControlOperation = defineWorkspaceOperation({
  id: 'mothership.runs.read_control',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})

export const readRunControl = defineAuthorizedChatUseCase({
  operation: readRunControlOperation,
  /** permission-group-exempt: observing Stop must remain available after Assistant access is withheld. */
  organizationOperation: defineOrganizationOperation({
    id: readRunControlOperation.id,
    minimumRole: 'member',
    capability: readRunControlOperation.capability,
    principalKinds: ['organization_delegated'],
    delegationAudience: RUN_CONTROL_AUDIENCE,
    delegatedServices: ['copilot'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: RunControlRequest
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {
    delegation: {
      audience: RUN_CONTROL_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.serviceId === 'copilot' &&
        principal.workspaceId === context.workspaceId &&
        (!principal.resourceScope?.chatId || principal.resourceScope.chatId === context.chatId),
    },
  },
  async execute({ input, context }) {
    const run = await getLatestRunForStream(input.streamId, context.userId)
    if (
      !run ||
      run.chatId !== context.chatId ||
      (run.workspaceId ?? null) !== (context.workspaceId ?? null) ||
      (run.organizationId ?? null) !== (context.organizationId ?? null)
    ) {
      throw new OrchestrationError('not_found', 'Stream not found')
    }
    return { stopped: await isRunStopRequested({ ...context, streamId: input.streamId }) }
  },
})
