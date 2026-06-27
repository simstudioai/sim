import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { setLocalCreditBalance } from '@/lib/billing/credits/balance'
import { setUsageLimitForCredits } from '@/lib/billing/credits/purchase'
import { mapLagoPlanToSimPlan } from '@/lib/billing/lago/config'
import { fromLagoCustomerExternalId, fromLagoSubscriptionExternalId } from '@/lib/billing/lago/external-ids'
import { upsertLocalSubscriptionFromLago } from '@/lib/billing/lago/subscriptions'
import { getLagoWalletBalance } from '@/lib/billing/lago/wallets'
import type {
  LagoWebhookEnvelope,
  LagoWebhookSubscription,
  LagoWebhookWallet,
} from '@/lib/billing/lago/types'
import { handleSubscriptionCreated } from '@/lib/billing/webhooks/subscription'
import { env } from '@/lib/core/config/env'

const logger = createLogger('LagoWebhooks')

function parseLagoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Verifies the `X-Lago-Signature` HMAC header when a webhook secret is configured.
 */
export function verifyLagoWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env.LAGO_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return true
  }
  if (!signatureHeader) {
    return false
  }

  const digest = createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = signatureHeader.replace(/^sha256=/, '')
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(provided))
  } catch {
    return false
  }
}

function extractSubscription(payload: LagoWebhookEnvelope): LagoWebhookSubscription | null {
  const object = payload.subscription ?? payload.object
  if (!object || typeof object !== 'object') return null
  return object as LagoWebhookSubscription
}

/**
 * Mirrors the authoritative Lago wallet balance into the local credit ledger and
 * recomputes the usage limit (planBase + prepaid credits). Idempotent — uses an
 * absolute set, so replays do not double-count.
 */
async function syncEntityCreditBalanceFromLago(
  entityType: 'user' | 'organization',
  entityId: string,
  creditsBalance: number
): Promise<void> {
  await setLocalCreditBalance(entityType, entityId, creditsBalance)
  const rows = await db
    .select({ plan: subscription.plan, seats: subscription.seats })
    .from(subscription)
    .where(eq(subscription.referenceId, entityId))
    .limit(1)
  if (rows[0]) {
    await setUsageLimitForCredits(entityType, entityId, rows[0].plan, rows[0].seats, creditsBalance)
  }
}

/**
 * Handles `wallet.created` / `wallet.updated` events — these carry the customer
 * external_id and the up-to-date credits balance directly.
 */
async function handleLagoWalletWebhook(payload: LagoWebhookEnvelope): Promise<void> {
  const wallet = payload.wallet as LagoWebhookWallet | undefined
  if (!wallet?.external_customer_id) {
    logger.info('Ignoring Lago wallet webhook without wallet payload', {
      webhookType: payload.webhook_type,
    })
    return
  }
  const entity = fromLagoCustomerExternalId(wallet.external_customer_id)
  if (!entity) {
    logger.warn('Lago wallet webhook external_customer_id not recognized', {
      externalCustomerId: wallet.external_customer_id,
    })
    return
  }
  const creditsBalance = Number(wallet.credits_balance ?? 0)
  await syncEntityCreditBalanceFromLago(entity.entityType, entity.entityId, creditsBalance)
  logger.info('Synced Lago wallet balance', {
    webhookType: payload.webhook_type,
    entityId: entity.entityId,
    creditsBalance,
  })
}

/**
 * Handles `wallet_transaction.*` events. The transaction object may omit the
 * customer reference; when present we re-read the live wallet balance and sync.
 * Otherwise `wallet.updated` (which always carries the balance) drives the sync.
 */
async function handleLagoWalletTransactionWebhook(payload: LagoWebhookEnvelope): Promise<void> {
  const txn = payload.wallet_transaction as { external_customer_id?: string } | undefined
  const externalCustomerId = txn?.external_customer_id
  if (!externalCustomerId) {
    logger.info('Lago wallet_transaction webhook without customer reference; relying on wallet.updated', {
      webhookType: payload.webhook_type,
    })
    return
  }
  const entity = fromLagoCustomerExternalId(externalCustomerId)
  if (!entity) return
  const balance = await getLagoWalletBalance(entity.entityType, entity.entityId)
  if (balance == null) return
  await syncEntityCreditBalanceFromLago(entity.entityType, entity.entityId, balance)
  logger.info('Synced Lago wallet balance from transaction', {
    webhookType: payload.webhook_type,
    entityId: entity.entityId,
    balance,
  })
}

/**
 * Processes a Lago webhook payload and syncs subscription state into Sim.
 */
export async function handleLagoWebhook(payload: LagoWebhookEnvelope): Promise<void> {
  const webhookType = payload.webhook_type

  if (payload.object_type === 'wallet' || webhookType.startsWith('wallet.')) {
    await handleLagoWalletWebhook(payload)
    return
  }
  if (
    payload.object_type === 'wallet_transaction' ||
    webhookType.startsWith('wallet_transaction')
  ) {
    await handleLagoWalletTransactionWebhook(payload)
    return
  }

  const lagoSub = extractSubscription(payload)

  if (!lagoSub?.external_id || !lagoSub.external_customer_id) {
    logger.info('Ignoring Lago webhook without subscription payload', { webhookType })
    return
  }

  const entity =
    fromLagoCustomerExternalId(lagoSub.external_customer_id) ??
    fromLagoSubscriptionExternalId(lagoSub.external_id)
  if (!entity) {
    logger.warn('Lago webhook customer external_id not recognized', {
      externalCustomerId: lagoSub.external_customer_id,
    })
    return
  }

  const planName = mapLagoPlanToSimPlan(lagoSub.plan_code)
  const periodStart = parseLagoDate(
    lagoSub.current_billing_period_started_at ?? lagoSub.started_at ?? null
  )
  const periodEnd = parseLagoDate(lagoSub.current_billing_period_ending_at ?? null)

  if (webhookType === 'subscription.terminated' || lagoSub.status === 'terminated') {
    await db
      .update(subscription)
      .set({
        status: 'canceled',
        endedAt: new Date(),
        canceledAt: parseLagoDate(lagoSub.canceled_at ?? lagoSub.terminated_at) ?? new Date(),
      })
      .where(eq(subscription.id, lagoSub.external_id))
    return
  }

  const previous = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.id, lagoSub.external_id))
    .limit(1)

  await upsertLocalSubscriptionFromLago({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planName,
    lagoSubscriptionId: lagoSub.lago_id,
    subscriptionExternalId: lagoSub.external_id,
    status: lagoSub.status,
    periodStart,
    periodEnd,
  })

  if (previous.length === 0) {
    await handleSubscriptionCreated({
      id: lagoSub.external_id,
      referenceId: entity.entityId,
      plan: planName,
      status: lagoSub.status === 'active' ? 'active' : lagoSub.status,
      periodStart,
      periodEnd,
    })
  } else {
    const updated = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, lagoSub.external_id))
      .limit(1)
    if (updated[0]) {
      await syncUsageLimitsFromSubscription(updated[0].referenceId)
    }
  }

  logger.info('Processed Lago webhook', {
    webhookType,
    subscriptionExternalId: lagoSub.external_id,
    planName,
    status: lagoSub.status,
  })
}
