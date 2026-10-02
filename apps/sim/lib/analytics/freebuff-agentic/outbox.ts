import { db } from '@sim/db'
import { freebuffAttribution } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { parseRetryAfter } from '@sim/utils/retry'
import { and, eq, lte } from 'drizzle-orm'
import { FREEBUFF_AGENTIC_OUTBOX_EVENT } from '@/lib/analytics/freebuff-agentic/service'
import { readFreebuffAttribution } from '@/lib/analytics/freebuff-agentic/token'
import { deferOutboxHandler, type OutboxHandlerRegistry } from '@/lib/core/outbox/service'

/** One HTTP attempt per outbox lease; the durable worker owns the three-attempt budget. */
export const freebuffAgenticOutboxHandlers: OutboxHandlerRegistry = {
  'freebuff.expire-attribution': async (payload) => {
    if (!isRecordLike(payload) || typeof payload.userId !== 'string') return
    await db
      .delete(freebuffAttribution)
      .where(
        and(
          eq(freebuffAttribution.userId, payload.userId),
          lte(freebuffAttribution.expiresAt, new Date())
        )
      )
  },
  [FREEBUFF_AGENTIC_OUTBOX_EVENT]: async (payload, context) => {
    if (
      !isRecordLike(payload) ||
      typeof payload.encryptedToken !== 'string' ||
      !['account_created', 'tool_used'].includes(String(payload.eventType)) ||
      typeof payload.eventId !== 'string' ||
      typeof payload.occurredAt !== 'string'
    ) {
      await context.checkpointPayload({ deliveryStatus: 'invalid_payload', encryptedToken: null })
      return
    }
    const captured = await readFreebuffAttribution(payload.encryptedToken)
    if (!captured) {
      await context.checkpointPayload({ deliveryStatus: 'expired', encryptedToken: null })
      return
    }
    const exhausted = context.attempts + 1 >= context.maxAttempts
    let response: Response
    try {
      response = await fetch('https://freebuff.com/api/ads/agentic/postback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversionToken: captured.token,
          eventType: payload.eventType,
          eventId: payload.eventId,
          occurredAt: payload.occurredAt,
        }),
        redirect: 'manual',
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
      })
    } catch {
      if (exhausted)
        await context.checkpointPayload({ deliveryStatus: 'retry_exhausted', encryptedToken: null })
      return deferOutboxHandler('Freebuff transport failure')
    }
    const status = response.status
    if (status === 429 || status >= 500) {
      await response.body?.cancel().catch(() => undefined)
      if (exhausted)
        await context.checkpointPayload({
          deliveryStatus: 'retry_exhausted',
          httpStatus: status,
          encryptedToken: null,
        })
      return deferOutboxHandler(
        `Freebuff HTTP ${status}`,
        parseRetryAfter(response.headers.get('Retry-After')) ?? undefined
      )
    }
    const result: unknown = response.ok ? await response.json().catch(() => null) : null
    if (!response.ok) await response.body?.cancel().catch(() => undefined)
    await context.checkpointPayload({
      deliveryStatus:
        response.ok && isRecordLike(result) && result.accepted === true ? 'accepted' : 'rejected',
      httpStatus: status,
      encryptedToken: null,
    })
  },
}
