import type { DelegatedPrincipal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream, isRunStopRequested } from '@/lib/mothership/async-runs/repository'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { RunControlRequest } from '@/lib/mothership/generated/run-control'

export const RUN_CONTROL_AUDIENCE = 'sim:copilot-run-control'
export const readRunControlOperation = defineWorkspaceOperation({
  id: 'mothership.runs.read_control',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})

export const readRunControl = defineAuthorizedWorkspaceUseCase({
  operation: readRunControlOperation,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal
    input: RunControlRequest
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {
    delegation: {
      audience: RUN_CONTROL_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.serviceId === 'copilot' && principal.workspaceId === context.workspaceId,
    },
  },
  async execute({ input, context }) {
    const run = await getLatestRunForStream(input.streamId, context.userId)
    if (!run || run.chatId !== context.chatId || run.workspaceId !== context.workspaceId) {
      throw new OrchestrationError('not_found', 'Stream not found')
    }
    return { stopped: await isRunStopRequested({ ...context, streamId: input.streamId }) }
  },
})
