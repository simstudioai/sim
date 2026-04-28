import { createLogger } from '@sim/logger'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isEnterprise, isPaid } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { sseHandlers } from '@/lib/copilot/request/handlers'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'

const logger = createLogger('CopilotBillingEffect')

/**
 * Handle a 402 billing-limit response from the Go backend.
 *
 * Determines whether the user needs a plan upgrade or a limit increase,
 * then dispatches synthetic text + complete events through the handler chain
 * so the client renders the upgrade prompt.
 */
export async function handleBillingLimitResponse(
  userId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions
): Promise<void> {
  let action: 'upgrade_plan' | 'increase_limit' = 'upgrade_plan'
  let message = "You've reached your usage limit. Please upgrade your plan to continue."
  try {
    const sub = await getHighestPrioritySubscription(userId)
    if (sub && isPaid(sub.plan)) {
      // Paid subs use the existing `increase_limit` action so the UI
      // (`UsageUpgradeDisplay`) renders its standard button. The message
      // text does the work of clarifying the action when the user can't
      // actually self-serve the limit change.
      action = 'increase_limit'
      const orgScoped = isOrgScopedSubscription(sub, userId)
      if (orgScoped) {
        message = isEnterprise(sub.plan)
          ? "You've reached your organization's usage limit for this billing period. Only an organization admin or Sim support can raise an enterprise limit — reach out to them to continue."
          : "You've reached your organization's usage limit for this billing period. Only an organization owner or admin can raise the limit — please ask them to update it from the team billing settings."
      } else {
        message =
          "You've reached your usage limit for this billing period. Please increase your usage limit from billing settings to continue."
      }
    }
  } catch {
    logger.warn('Failed to determine subscription plan, defaulting to upgrade_plan')
  }

  const upgradePayload = JSON.stringify({
    reason: 'usage_limit',
    action,
    message,
  })
  const syntheticContent = `<usage_upgrade>${upgradePayload}</usage_upgrade>`

  const syntheticEvents: StreamEvent[] = [
    {
      type: MothershipStreamV1EventType.text,
      payload: {
        channel: MothershipStreamV1TextChannel.assistant,
        text: syntheticContent,
      },
    },
    {
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: MothershipStreamV1CompletionStatus.complete,
      },
    },
  ]

  for (const event of syntheticEvents) {
    try {
      await options.onEvent?.(event)
    } catch {
      logger.warn('Failed to forward synthetic billing event', { type: event.type })
    }

    // TODO: Handler dispatch should move out of this effect — effects should be
    // pure side-effect producers; event dispatch belongs in the stream loop or
    // a dedicated dispatcher. Keeping here for now to preserve behavior.
    const handler = sseHandlers[event.type]
    if (handler) {
      await handler(event, context, execContext, options)
    }
    if (context.streamComplete) break
  }
}
