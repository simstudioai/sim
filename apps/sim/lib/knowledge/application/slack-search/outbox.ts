import { db } from '@sim/db'
import { slackSearchTurn } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  deferOutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import {
  readySlackSearchDispatches,
  SLACK_SEARCH_TURN_EVENT,
  slackSearchTurnOutboxId,
} from '@/lib/knowledge/application/slack-search/turns'
import { enqueueSlackSearch } from '@/lib/slack-search/queue'

export const slackSearchDispatchSchema = z.object({ turnId: z.string().min(1).max(200) })

/** The outbox retries scheduling only. Running or completed turns cannot execute twice. */
export const slackSearchOutboxHandlers = {
  [SLACK_SEARCH_TURN_EVENT]: async (payload, context) => {
    const { turnId } = slackSearchDispatchSchema.parse(payload)
    const [turn] = await db
      .select()
      .from(slackSearchTurn)
      .where(eq(slackSearchTurn.id, turnId))
      .limit(1)
    if (!turn || ['completed', 'failed', 'cancelled'].includes(turn.status)) return
    context.signal.throwIfAborted()
    if (
      turn.status === 'pending' ||
      (turn.leaseExpiresAt && turn.leaseExpiresAt.getTime() <= Date.now())
    ) {
      await enqueueSlackSearch({ turnId, installationId: turn.installationId })
    }
    return deferOutboxHandler('Waiting for the durable Slack turn', 1_000, false)
  },
} satisfies OutboxHandlerRegistry

export function dispatchSlackSearchTurn(turnId: string) {
  return processOutboxEventById(slackSearchTurnOutboxId(turnId), slackSearchOutboxHandlers)
}

/** Completion promptly wakes queued follow-ups; the shared outbox cron repairs crashes. */
export async function dispatchPendingSlackSearchTurns(installationId: string) {
  const ids = await readySlackSearchDispatches(installationId)
  for (const id of ids) await processOutboxEventById(id, slackSearchOutboxHandlers)
}
