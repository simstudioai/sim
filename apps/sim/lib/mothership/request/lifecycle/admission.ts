import {
  type AttributedBillingRequestEnvelope,
  BILLING_ATTRIBUTION_HEADER,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
  requireBillingCallbackAttribution,
} from '@/lib/billing/core/billing-attribution'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  authorizeCopilotChatCallback,
  checkCopilotContinuationBilling,
} from '@/lib/mothership/application/authorize-chat-callback'
import { BillingAdmissionSchema } from '@/lib/mothership/request/lifecycle/recovery-config'
import type { ExecutionContext } from '@/lib/mothership/request/types'

/** Restores only the original server-owned admission, never a newly selected payer. */
export function restoreBillingAdmission(
  value: unknown,
  scope: { userId: string; workspaceId?: string; organizationId?: string }
) {
  const admission = BillingAdmissionSchema.parse(value)
  const headers = {
    [COPILOT_BILLING_PROTOCOL_HEADER]: COPILOT_BILLING_PROTOCOL.attributed,
    [BILLING_REQUEST_ID_HEADER]: admission.billingRequestId,
    [BILLING_ATTRIBUTION_HEADER]: admission.serializedAttribution,
  }
  const attribution = requireBillingCallbackAttribution(new Headers(headers), {
    actorUserId: scope.userId,
    workspaceId: scope.workspaceId,
    organizationId: scope.organizationId,
  })
  const envelope: AttributedBillingRequestEnvelope = { ...admission, headers }
  return { attribution, envelope }
}

/** Every resumed model leg rechecks authority and account standing without reading spend. */
export async function authorizeLifecycleContinuation(
  context: Pick<
    ExecutionContext,
    | 'userId'
    | 'workspaceId'
    | 'organizationId'
    | 'chatId'
    | 'runId'
    | 'messageId'
    | 'requestMode'
    | 'billingAttribution'
  >
) {
  await authorizeCopilotChatCallback({
    userId: context.userId,
    workspaceId: context.workspaceId,
    organizationId: context.organizationId,
    chatId: context.chatId,
    delegationId: context.runId ?? context.messageId ?? context.chatId ?? context.userId,
    purpose: 'continuation',
    mode:
      context.requestMode === 'plan'
        ? 'plan'
        : context.requestMode === 'assistant'
          ? 'assistant'
          : 'agent',
  })
  if (isHosted) {
    if (!context.billingAttribution)
      throw new OrchestrationError('forbidden', 'Continuation is missing its billing admission')
    const standing = await checkCopilotContinuationBilling({
      kind: 'attributed',
      attribution: context.billingAttribution,
    })
    if (standing.blocked)
      throw new OrchestrationError('forbidden', 'Continuation billing account is blocked')
  }
}
