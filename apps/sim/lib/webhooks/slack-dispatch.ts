import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import {
  checkWebhookPreprocessing,
  type findWebhooksByRoutingKey,
  queueWebhookExecution,
} from '@/lib/webhooks/processor'
import { resolveSlackEventKey, shouldSkipSlackTriggerEvent } from '@/lib/webhooks/providers/slack'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'

const logger = createLogger('SlackWebhookDispatch')

interface DispatchSlackWebhooksOptions {
  body: unknown
  request: NextRequest
  requestId: string
  receivedAt: number
}

/**
 * Shared fan-out tail for the Slack ingest routes (native team-id route and the
 * custom-bot credential route): run each candidate webhook through the trigger
 * filter, verify its block is still deployed, preprocess, and enqueue. Keeping
 * this in one place stops the skip/preprocess/queue sequence drifting between
 * the two ingest paths.
 */
export async function dispatchSlackWebhooks(
  webhooks: Awaited<ReturnType<typeof findWebhooksByRoutingKey>>,
  { body, request, requestId, receivedAt }: DispatchSlackWebhooksOptions
): Promise<void> {
  const payload = body as Record<string, unknown>
  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const parsedTimestampMs = slackRequestTimestamp ? Number(slackRequestTimestamp) * 1000 : undefined
  const triggerTimestampMs = Number.isFinite(parsedTimestampMs) ? parsedTimestampMs : undefined

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooks) {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}

    // Shared trigger filter (event, source, threads, emoji, name, channels,
    // interaction, self-drop, bot).
    if (shouldSkipSlackTriggerEvent(payload, providerConfig)) {
      const rawEvent = payload.event as Record<string, unknown> | undefined
      logger.info(`[${requestId}] Event skipped by trigger filter for webhook ${foundWebhook.id}`, {
        eventKey: resolveSlackEventKey(payload),
        configuredEvent: providerConfig.eventType,
        channelType: rawEvent?.channel_type,
        subtype: rawEvent?.subtype,
        isThreadReply:
          typeof rawEvent?.thread_ts === 'string' && rawEvent.thread_ts !== rawEvent.ts,
        threadsSetting: providerConfig.threads,
        botId: rawEvent?.bot_id,
      })
      continue
    }

    if (foundWebhook.blockId) {
      const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
      if (!blockExists) {
        logger.info(
          `[${requestId}] Trigger block ${foundWebhook.blockId} not in deployment for ${foundWorkflow.id}`
        )
        continue
      }
    }

    const preprocessResult = await checkWebhookPreprocessing(foundWorkflow, foundWebhook, requestId)
    if (preprocessResult.error) {
      logger.warn(`[${requestId}] Preprocessing failed for webhook ${foundWebhook.id}`)
      continue
    }

    await queueWebhookExecution(foundWebhook, foundWorkflow, body, request, {
      requestId,
      actorUserId: preprocessResult.actorUserId,
      executionId: preprocessResult.executionId,
      correlation: preprocessResult.correlation,
      receivedAt,
      triggerTimestampMs,
    })
  }
}
