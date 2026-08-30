import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  type CopilotEnvironmentContext,
  prepareCopilotEnvironmentContext,
} from '@/lib/mothership/environment-context'
import type { ExecutionContext } from '@/lib/mothership/request/types'
import { getWorkflowById } from '@/lib/workflows/utils'

export async function prepareExecutionContext(
  userId: string,
  workflowId: string,
  chatId?: string,
  options?: {
    workspaceId?: string
    environmentContext?: CopilotEnvironmentContext
    billingAttribution?: BillingAttributionSnapshot
  }
): Promise<ExecutionContext> {
  const workspaceId =
    options?.workspaceId ?? (await getWorkflowById(workflowId))?.workspaceId ?? undefined
  const [environmentContext, billingAttribution] = await Promise.all([
    options?.environmentContext ?? prepareCopilotEnvironmentContext(userId, workspaceId),
    options?.billingAttribution
      ? Promise.resolve(assertBillingAttributionSnapshot(options.billingAttribution))
      : workspaceId
        ? resolveBillingAttribution({ actorUserId: userId, workspaceId })
        : Promise.resolve(undefined),
  ])
  if (
    billingAttribution &&
    (billingAttribution.actorUserId !== userId || billingAttribution.workspaceId !== workspaceId)
  ) {
    throw new Error('Copilot billing attribution does not match its actor and workspace')
  }

  return {
    userId,
    workflowId,
    workspaceId,
    chatId,
    ...environmentContext,
    billingAttribution,
  }
}
