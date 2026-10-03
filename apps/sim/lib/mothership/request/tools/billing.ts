import { createLogger } from '@sim/logger'
import { formatUsageUpgradeTag, resolveUsageUpgradePayload } from '@/lib/billing/usage-upgrade'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { sseHandlers } from '@/lib/mothership/request/handlers'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'

const logger = createLogger('CopilotBillingEffect')

/**
 * Ends the turn with the usage card: a refused dispatch or continuation, a worker 402, or a
 * worker usage-limit terminal that arrived without a card of its own.
 *
 * Dispatches synthetic text + complete events through the handler chain so the client renders
 * the upgrade prompt and the turn finishes as complete, so the next message after an upgrade
 * starts normally.
 */
export async function handleBillingLimitResponse(
  userId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  scope?: 'actor' | 'payer' | 'member'
): Promise<void> {
  const payload = await resolveUsageUpgradePayload(userId, execContext.billingAttribution, scope)
  const syntheticContent = formatUsageUpgradeTag(payload)
  // The card is this turn's terminal even when the refused leg follows one that already ended.
  context.streamComplete = false

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
