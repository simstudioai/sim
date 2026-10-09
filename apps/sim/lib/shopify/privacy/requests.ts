import { db } from '@sim/db'
import { shopifyPrivacyRequest } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { encryptSecret } from '@/lib/core/security/encryption'
import { SHOPIFY_PRIVACY_RECEIVED_EVENT } from '@/lib/shopify/privacy/outbox-events'
import type { ShopifyPrivacyTopic } from '@/lib/shopify/privacy/types'

interface PrivacyReceiptInput {
  clientId: string
  webhookId: string
  topic: ShopifyPrivacyTopic
  shopId: string
  shopDomain: string
  payloadHash: string
  rawBody: string
  receivedAt: Date
}

/** Commits a private receipt and its dispatch together, including concurrent replay handling. */
export async function storeShopifyPrivacyReceipt(input: PrivacyReceiptInput): Promise<void> {
  const encryptedPayload = (await encryptSecret(input.rawBody)).encrypted
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(shopifyPrivacyRequest)
      .values({
        id: generateId(),
        clientId: input.clientId,
        webhookId: input.webhookId,
        topic: input.topic,
        shopId: input.shopId,
        shopDomain: input.shopDomain,
        payloadHash: input.payloadHash,
        encryptedPayload,
        receivedAt: input.receivedAt,
        dueAt: new Date(input.receivedAt.getTime() + 30 * 24 * 60 * 60_000),
      })
      .onConflictDoNothing({
        target: [shopifyPrivacyRequest.clientId, shopifyPrivacyRequest.webhookId],
      })
      .returning({ id: shopifyPrivacyRequest.id })
    if (created) {
      await enqueueOutboxEvent(tx, SHOPIFY_PRIVACY_RECEIVED_EVENT, { requestId: created.id })
      return
    }
    const [receipt] = await tx
      .select({
        payloadHash: shopifyPrivacyRequest.payloadHash,
        topic: shopifyPrivacyRequest.topic,
      })
      .from(shopifyPrivacyRequest)
      .where(
        and(
          eq(shopifyPrivacyRequest.clientId, input.clientId),
          eq(shopifyPrivacyRequest.webhookId, input.webhookId)
        )
      )
      .limit(1)
    if (!receipt) throw new Error('Privacy receipt conflict could not be resolved')
    if (receipt.payloadHash !== input.payloadHash || receipt.topic !== input.topic) {
      throw new OrchestrationError('conflict', 'Webhook delivery conflicts with its stored receipt')
    }
  })
}
