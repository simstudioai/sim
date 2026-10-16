import type { DelegatedPrincipal } from '@sim/auth/principal'
import {
  type AccountBillingDecision,
  type BillingAttributionSnapshot,
  checkAccountBillingBlocks,
  checkAttributedBillingBlocks,
} from '@/lib/billing/core/attribution'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { chatOperations } from '@/lib/mothership/application/operations'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
  createTrustedPersonalChatPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import {
  COPILOT_VALIDATION_PURPOSE,
  type CopilotValidationPurpose,
} from '@/lib/mothership/generated/billing-protocol-v1'
import { RunControlRequest } from '@/lib/mothership/generated/run-control'
import { authorizeOriginalRun } from '@/lib/mothership/request/application/run-authorization'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

const CALLBACK_AUDIENCE = 'sim:copilot-callback'

interface WorkspaceCallbackInput {
  workspaceId: string
}

const workspaceCallbackAuthorization = {
  resolveContext: ({ input }: { input: WorkspaceCallbackInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {
    delegation: {
      audience: CALLBACK_AUDIENCE,
      isWithinScope: (principal: DelegatedPrincipal) => Boolean(principal.subjectUserId),
    },
  },
  async execute() {},
}

const continueWorkspaceChat = defineAuthorizedWorkspaceUseCase({
  operation: chatOperations.continue,
  ...workspaceCallbackAuthorization,
})
const cancelWorkspaceChat = defineAuthorizedWorkspaceUseCase({
  operation: chatOperations.cancel,
  ...workspaceCallbackAuthorization,
})

interface CopilotChatCallbackContext {
  executionStreamId?: string
  userId: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  delegationId: string
  purpose: Exclude<CopilotValidationPurpose, 'new-turn'>
  mode?: 'assistant' | 'agent' | 'plan'
}

/** Reauthorizes the original server-owned scope across a model lifecycle boundary. */
export async function authorizeCopilotChatCallback(context: CopilotChatCallbackContext) {
  if (context.executionStreamId !== undefined) {
    if (
      !context.chatId ||
      (context.workspaceId && context.organizationId) ||
      !RunControlRequest.shape.streamId.safeParse(context.executionStreamId).success
    )
      throw new OrchestrationError('forbidden', 'Invalid conversation scope')
    const identity = { ...context, chatId: context.chatId }
    const options = { audience: CALLBACK_AUDIENCE, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
    const principal = context.organizationId
      ? createTrustedOrganizationCopilotPrincipal(
          { ...identity, organizationId: context.organizationId },
          options
        )
      : context.workspaceId
        ? createTrustedCopilotPrincipal({ ...identity, workspaceId: context.workspaceId }, options)
        : createTrustedPersonalChatPrincipal(identity, options)
    await authorizeOriginalRun({
      principal,
      chatId: context.chatId,
      streamId: context.executionStreamId,
      audience: CALLBACK_AUDIENCE,
      mode: context.mode,
      capability:
        context.purpose === COPILOT_VALIDATION_PURPOSE.cancellation ? 'none' : 'copilot.use',
    })
    return
  }
  if (context.organizationId) {
    if (!context.chatId || context.workspaceId) {
      throw new OrchestrationError('forbidden', 'Invalid conversation scope')
    }
    const principal = createTrustedOrganizationCopilotPrincipal(
      { ...context, organizationId: context.organizationId, chatId: context.chatId },
      {
        audience:
          context.purpose === COPILOT_VALIDATION_PURPOSE.cancellation
            ? 'sim:copilot-cancel'
            : 'sim:copilot-billing',
        ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
      }
    )
    await authorizeOrganizationChatDelegation.execute({ principal, mode: context.mode })
    return
  }
  if (!context.workspaceId)
    throw new OrchestrationError(
      'forbidden',
      'Personal continuation requires original execution identity'
    )

  const principal = createTrustedCopilotPrincipal(
    { ...context, workspaceId: context.workspaceId },
    { audience: CALLBACK_AUDIENCE, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
  )
  const useCase =
    context.purpose === COPILOT_VALIDATION_PURPOSE.cancellation
      ? cancelWorkspaceChat
      : continueWorkspaceChat
  await useCase.execute({ principal, input: { workspaceId: context.workspaceId } })
}

export type CopilotContinuationBilling =
  | { kind: 'attributed'; attribution: BillingAttributionSnapshot }
  | { kind: 'account'; decision: AccountBillingDecision }

/** Checks account standing against the original admission; never reads spend or selects a new payer. */
export async function checkCopilotContinuationBilling(billing: CopilotContinuationBilling) {
  return billing.kind === 'attributed'
    ? checkAttributedBillingBlocks(billing.attribution)
    : checkAccountBillingBlocks(billing.decision)
}
