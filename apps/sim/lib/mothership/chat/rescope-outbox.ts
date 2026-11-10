import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { deferOutboxHandler, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { CHAT_RESCOPE_EVENT, chatRescopePayloadSchema } from '@/lib/mothership/chat/rescope-event'
import { type RescopeChatsRequest, RescopeChatsResponse } from '@/lib/mothership/generated/protocol'
import {
  deliverRunStop,
  readStoppedRunWork,
} from '@/lib/mothership/request/application/stop-delivery'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const logger = createLogger('ChatRescopeOutbox')

/** The rescope is one indexed update of at most a thousand rows. */
const RESCOPE_TIMEOUT_MS = 30_000

/**
 * A worker without the route answers 404 until the release that adds it is live; the event waits
 * for it without spending attempts.
 */
const MISSING_ROUTE_BACKOFF_MS = 10 * 60 * 1000

export const chatRescopeOutboxHandlers = {
  /**
   * Delivers the Stop of every run the move stopped (its Stop is already durable; this reaches
   * the worker, the desktop and the run's controller), then moves the worker's copy of the chats.
   * Any refusal other than a missing route throws for the outbox to retry; the worker's move is
   * idempotent, and a repeated Stop of an ended run is a no-op.
   */
  [CHAT_RESCOPE_EVENT]: async (rawPayload, context) => {
    const payload = chatRescopePayloadSchema.parse(rawPayload)
    if (payload.stoppedRuns.length > 0) {
      await Promise.all(
        payload.stoppedRuns.map((run) =>
          deliverRunStop(run, readStoppedRunWork(run.streamId, run.userId))
        )
      )
      await context.checkpointPayload({ stoppedRuns: [] })
    }
    context.signal.throwIfAborted()
    /** Without a key Sim never reached a worker, so no worker holds these chats. */
    if (!env.COPILOT_API_KEY) {
      logger.info('Skipping worker chat rescope without a copilot key', {
        eventId: context.eventId,
      })
      return
    }

    const request: RescopeChatsRequest = {
      chatIds: payload.chatIds,
      from: { organizationId: payload.fromOrganizationId },
      to: { workspaceId: payload.toWorkspaceId },
    }
    const baseURL = await getMothershipBaseURL({ userId: payload.userId })
    const response = await fetchGo(`${baseURL}/api/chats/rescope`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(RESCOPE_TIMEOUT_MS)]),
      spanName: 'sim → worker /api/chats/rescope',
      operation: 'rescope_chats',
    })
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined)
      return deferOutboxHandler(
        'The worker has no chat rescope route yet',
        MISSING_ROUTE_BACKOFF_MS,
        false
      )
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Worker refused the chat rescope with ${response.status}`)
    }
    const { rescoped } = RescopeChatsResponse.parse(await response.json())
    logger.info('Moved worker chats into their new workspace', {
      eventId: context.eventId,
      chatCount: payload.chatIds.length,
      rescoped,
    })
  },
} satisfies OutboxHandlerRegistry
