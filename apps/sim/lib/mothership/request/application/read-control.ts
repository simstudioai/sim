import type {
  DelegatedPrincipal,
  OrganizationDelegatedPrincipal,
  Principal,
} from '@sim/auth/principal'
import {
  type AuthorizingUseCase,
  DelegatedServiceAuthorizationError,
  DelegatedWorkspaceAuthorizationError,
  defineWorkspaceOperation,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application'
import { OrganizationDelegationAuthorizationError } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream, isRunStopRequested } from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { RunControlRequest, RunControlState } from '@/lib/mothership/generated/run-control'

export const RUN_CONTROL_AUDIENCE = 'sim:copilot-run-control'
// permission-group-exempt: observing stop state must remain possible after Copilot access is withheld
export const readRunControlOperation = defineWorkspaceOperation({
  id: 'mothership.runs.read_control',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  contentDelivery: 'none',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})

/** Answers for a run Sim still has: its chat live, its owner still allowed, Stop not requested. */
const readLiveRunControl = defineAuthorizedChatUseCase({
  operation: readRunControlOperation,
  /** permission-group-exempt: observing Stop must remain available after Assistant access is withheld. */
  organizationOperation: defineOrganizationOperation({
    id: readRunControlOperation.id,
    contentDelivery: 'none',
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

/**
 * A refusal of the caller's delegation itself (expired mid-request, or out of scope), which
 * says nothing about whether the run may continue.
 */
function isCallerRefusal(error: OrchestrationError): boolean {
  return (
    error instanceof DelegatedWorkspaceAuthorizationError ||
    error instanceof DelegatedServiceAuthorizationError ||
    error instanceof PrincipalKindAuthorizationError ||
    error instanceof OrganizationDelegationAuthorizationError
  )
}

/** The worker asking about its own run: a copilot delegation for this chat, still in date. */
function requireRunControlCaller(principal: Principal, input: RunControlRequest): void {
  if (principal.kind !== 'delegated' && principal.kind !== 'organization_delegated')
    throw new OrchestrationError('forbidden', 'Run control delegation is not valid')
  /** A workspace delegation may leave the chat unscoped; an organization one always names it. */
  const chatScope =
    principal.kind === 'delegated'
      ? (principal.resourceScope?.chatId ?? input.chatId)
      : principal.serviceId === 'copilot'
        ? principal.resourceScope.chatId
        : undefined
  if (
    principal.serviceId !== 'copilot' ||
    principal.audience !== RUN_CONTROL_AUDIENCE ||
    principal.expiresAt.getTime() <= Date.now() ||
    chatScope !== input.chatId
  ) {
    throw new OrchestrationError('forbidden', 'Run control delegation is not valid')
  }
}

/**
 * Whether the worker's run may continue. Sim is the authority, so a run whose chat was
 * deleted, whose owner or workspace is gone, or whose owner lost access answers Stop rather
 * than an error the worker can only retry: a deletion stops its runs even when no push
 * reached the worker. Only a failure to read the answer is an error.
 */
export const readRunControl: AuthorizingUseCase<
  typeof readRunControlOperation,
  RunControlRequest,
  RunControlState
> = {
  operation: readRunControlOperation,
  async authorize({ principal, input }) {
    requireRunControlCaller(principal, input)
  },
  async execute(args) {
    requireRunControlCaller(args.principal, args.input)
    try {
      return await readLiveRunControl.execute(args)
    } catch (error) {
      const refusal = asOrchestrationError(error)
      if (
        (refusal?.code === 'not_found' || refusal?.code === 'forbidden') &&
        !isCallerRefusal(refusal)
      )
        return { stopped: true }
      throw error
    }
  },
}
