import { db } from '@sim/db'
import { freebuffAttribution, outboxEvent, user } from '@sim/db/schema'
import { and, eq, gt, lte } from 'drizzle-orm'
import { readFreebuffAttribution } from '@/lib/analytics/freebuff-agentic/token'

export const FREEBUFF_AGENTIC_OUTBOX_EVENT = 'freebuff.agentic-conversion'
type AttributionDatabase = Pick<typeof db, 'insert' | 'select'>

/** Binds attribution only to the authenticated human supplied by the auth lifecycle. */
export async function bindFreebuffAttribution(
  userId: string,
  encryptedToken: string | undefined
): Promise<void> {
  const captured = await readFreebuffAttribution(encryptedToken)
  if (!captured || !encryptedToken) return
  await db.transaction(async (tx) => {
    await tx
      .insert(freebuffAttribution)
      .values({
        userId,
        encryptedToken,
        capturedAt: new Date(captured.capturedAt),
        expiresAt: new Date(captured.expiresAt),
      })
      .onConflictDoUpdate({
        target: freebuffAttribution.userId,
        set: {
          encryptedToken,
          capturedAt: new Date(captured.capturedAt),
          expiresAt: new Date(captured.expiresAt),
        },
        setWhere: lte(freebuffAttribution.capturedAt, new Date(captured.capturedAt)),
      })
    const [account] = await tx
      .select({ createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const accountCreatedAt = account?.createdAt
    await tx
      .insert(outboxEvent)
      .values({
        id: `freebuff:expire:${userId}:${captured.capturedAt}`,
        eventType: 'freebuff.expire-attribution',
        payload: { userId },
        availableAt: new Date(captured.expiresAt),
        maxAttempts: 3,
      })
      .onConflictDoNothing({ target: outboxEvent.id })
    if (accountCreatedAt && accountCreatedAt.getTime() >= captured.capturedAt) {
      await enqueueConversion(tx, encryptedToken, 'account_created', userId, accountCreatedAt)
    }
  })
}

/** Called within the transaction persisting a successful execution, using its actual human actor. */
export async function enqueueFreebuffUse(
  tx: AttributionDatabase,
  userId: string,
  executionId: string,
  occurredAt: Date
): Promise<void> {
  const [attribution] = await tx
    .select()
    .from(freebuffAttribution)
    .where(
      and(
        eq(freebuffAttribution.userId, userId),
        gt(freebuffAttribution.expiresAt, occurredAt),
        lte(freebuffAttribution.capturedAt, occurredAt)
      )
    )
    .limit(1)
  if (!attribution) return
  await enqueueConversion(tx, attribution.encryptedToken, 'tool_used', executionId, occurredAt)
}

async function enqueueConversion(
  tx: AttributionDatabase,
  encryptedToken: string,
  eventType: 'account_created' | 'tool_used',
  id: string,
  occurredAt: Date
): Promise<void> {
  const eventId = `${eventType}:${id}`
  await tx
    .insert(outboxEvent)
    .values({
      id: `freebuff:${eventId}`,
      eventType: FREEBUFF_AGENTIC_OUTBOX_EVENT,
      payload: { encryptedToken, eventType, eventId, occurredAt: occurredAt.toISOString() },
      maxAttempts: 3,
    })
    .onConflictDoNothing({ target: outboxEvent.id })
}
