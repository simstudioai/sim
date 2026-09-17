import type { DelegatedPrincipal } from '@sim/auth/principal'
import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
} from '@/lib/billing/calculations/usage-monitor'
import {
  type AccountBillingDecision,
  type BillingAttributionSnapshot,
  checkAttributedBillingBlocks,
} from '@/lib/billing/core/billing-attribution'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { chatOperations } from '@/lib/mothership/application/operations'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import {
  COPILOT_VALIDATION_PURPOSE,
  type CopilotValidationPurpose,
} from '@/lib/mothership/generated/billing-protocol-v1'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

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
  userId: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  delegationId: string
  purpose: Exclude<CopilotValidationPurpose, 'new-turn'>
  mode?: 'assistant' | 'agent'
}

/** Reauthorizes the original server-owned scope across a model lifecycle boundary. */
export async function authorizeCopilotChatCallback(context: CopilotChatCallbackContext) {
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
  if (!context.workspaceId) return

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
  if (billing.kind === 'attributed') return checkAttributedBillingBlocks(billing.attribution)

  const actor = await checkBillingBlocked(billing.decision.userId)
  if (actor.blocked) return { ...actor, scope: 'actor' }
  const payer = billing.decision.billingEntity
  if (payer.type === 'user' && payer.id === billing.decision.userId) return actor
  return { ...(await checkBillingEntityBlocked(payer)), scope: 'payer' }
}
