import { db } from '@sim/db'
import { shopifyInstallationAttempt, shopifyPrivacyRequest } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { SHOPIFY_PRIVACY_RECEIVED_EVENT } from '@/lib/shopify/privacy/outbox-events'

const logger = createLogger('ShopifyPrivacyOperations')
const eventSchema = z.object({ requestId: z.string().min(1).max(200) })

/** Dispatch completion means an operator case is ready; it never means privacy fulfillment. */
export const shopifyPrivacyOutboxHandlers = {
  [SHOPIFY_PRIVACY_RECEIVED_EVENT]: async (payload, context) => {
    const { requestId } = eventSchema.parse(payload)
    context.signal.throwIfAborted()
    const updated = await db
      .update(shopifyPrivacyRequest)
      .set({
        status: 'awaiting_review',
        triagedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(shopifyPrivacyRequest.id, requestId), eq(shopifyPrivacyRequest.status, 'received'))
      )
      .returning({ id: shopifyPrivacyRequest.id })
    if (updated.length) logger.warn('Privacy request requires operator review', { requestId })
  },
} satisfies OutboxHandlerRegistry

/** Bounded maintenance runs even on an idle outbox, without sending external notifications. */
export async function maintainShopifyPrivacy(): Promise<void> {
  const now = new Date()
  const expiredAttempts = db
    .select({ id: shopifyInstallationAttempt.id })
    .from(shopifyInstallationAttempt)
    .where(lte(shopifyInstallationAttempt.expiresAt, now))
    .orderBy(asc(shopifyInstallationAttempt.expiresAt))
    .limit(100)
    .for('update', { skipLocked: true })
  await db
    .delete(shopifyInstallationAttempt)
    .where(
      and(
        inArray(shopifyInstallationAttempt.id, expiredAttempts),
        lte(shopifyInstallationAttempt.expiresAt, now)
      )
    )
  const dueCases = db
    .select({ id: shopifyPrivacyRequest.id })
    .from(shopifyPrivacyRequest)
    .where(
      and(
        isNull(shopifyPrivacyRequest.completedAt),
        isNull(shopifyPrivacyRequest.escalatedAt),
        lte(shopifyPrivacyRequest.dueAt, new Date(now.getTime() + 7 * 24 * 60 * 60_000))
      )
    )
    .orderBy(asc(shopifyPrivacyRequest.dueAt), asc(shopifyPrivacyRequest.id))
    .limit(100)
  const escalated = await db
    .update(shopifyPrivacyRequest)
    .set({ escalatedAt: now, updatedAt: now })
    .where(
      and(
        inArray(shopifyPrivacyRequest.id, dueCases),
        isNull(shopifyPrivacyRequest.completedAt),
        isNull(shopifyPrivacyRequest.escalatedAt)
      )
    )
    .returning({ id: shopifyPrivacyRequest.id })
  if (escalated.length)
    logger.error('Privacy requests are approaching or past their deadlines', {
      requestIds: escalated.map((row) => row.id),
    })
}
