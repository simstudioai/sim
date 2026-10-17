import {
  type AuthorizingUseCase,
  DelegatedServiceAuthorizationError,
  DelegatedWorkspaceAuthorizationError,
  defineWorkspaceOperation,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application'
import { OrganizationDelegationAuthorizationError } from '@/lib/core/application/organization-authorization'
import { asOrchestrationError, type OrchestrationError } from '@/lib/core/orchestration/types'
import { isRunStopRequested } from '@/lib/mothership/async-runs/repository'
import type { RunControlRequest, RunControlState } from '@/lib/mothership/generated/run-control'
import {
  authorizeOriginalRun,
  RunDelegationAuthorizationError,
  requireRunDelegation,
} from '@/lib/mothership/request/application/run-authorization'

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

/**
 * A refusal of the caller's delegation itself (expired mid-request, or out of scope), which
 * says nothing about whether the run may continue.
 */
function isCallerRefusal(error: OrchestrationError): boolean {
  return (
    error instanceof RunDelegationAuthorizationError ||
    error instanceof DelegatedWorkspaceAuthorizationError ||
    error instanceof DelegatedServiceAuthorizationError ||
    error instanceof PrincipalKindAuthorizationError ||
    error instanceof OrganizationDelegationAuthorizationError
  )
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
    requireRunDelegation(principal, RUN_CONTROL_AUDIENCE, input.chatId, input.streamId)
  },
  async execute(args) {
    requireRunDelegation(
      args.principal,
      RUN_CONTROL_AUDIENCE,
      args.input.chatId,
      args.input.streamId
    )
    try {
      const { run } = await authorizeOriginalRun({
        ...args.input,
        principal: args.principal,
        audience: RUN_CONTROL_AUDIENCE,
        capability: 'none',
      })
      return {
        stopped: await isRunStopRequested({
          userId: run.userId,
          streamId: args.input.streamId,
          workspaceId: run.workspaceId,
          organizationId: run.organizationId,
        }),
      }
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
