import { db } from '@sim/db'
import { subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { upsertLagoCustomer } from '@/lib/billing/lago/customers'
import { createLagoSubscription } from '@/lib/billing/lago/subscriptions'
import { ensureLagoWallet } from '@/lib/billing/lago/wallets'
import type { LagoBillingEntityType } from '@/lib/billing/lago/types'
import { hasValidLagoCredentials } from '@/lib/billing/lago/client'
import { isBillingEnabled, isLagoBillingProvider } from '@/lib/core/config/env-flags'

const logger = createLogger('LagoProvision')

interface ProvisionBillingEntityParams {
  entityType: LagoBillingEntityType
  entityId: string
  name?: string | null
  email?: string | null
  planName?: string
}

/**
 * Ensures a Sim billing entity exists in Lago with a local free subscription.
 */
export async function provisionLagoBillingEntity(
  params: ProvisionBillingEntityParams
): Promise<void> {
  if (!isBillingEnabled || !isLagoBillingProvider || !hasValidLagoCredentials()) {
    return
  }

  const planName = params.planName ?? 'free'

  const existing = await db
    .select({
      id: subscription.id,
      billingProvider: subscription.billingProvider,
      lagoSubscriptionId: subscription.lagoSubscriptionId,
    })
    .from(subscription)
    .where(eq(subscription.referenceId, params.entityId))
    .limit(1)

  const customer = await upsertLagoCustomer({
    entityType: params.entityType,
    entityId: params.entityId,
    name: params.name,
    email: params.email,
  })

  if (
    existing.length > 0 &&
    existing[0].billingProvider === 'lago' &&
    existing[0].lagoSubscriptionId
  ) {
    await ensureLagoWallet(params.entityType, params.entityId)
    return
  }

  await createLagoSubscription({
    entityType: params.entityType,
    entityId: params.entityId,
    planName,
    lagoCustomerId: customer.lago_id,
  })

  await ensureLagoWallet(params.entityType, params.entityId)

  logger.info('Provisioned Lago billing entity', {
    entityType: params.entityType,
    entityId: params.entityId,
    planName,
  })
}

/**
 * Provisions Lago billing for a newly registered user.
 */
export async function provisionLagoBillingForUser(userId: string): Promise<void> {
  const rows = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  const profile = rows[0]
  await provisionLagoBillingEntity({
    entityType: 'user',
    entityId: userId,
    name: profile?.name,
    email: profile?.email,
    planName: 'free',
  })
}

/**
 * Provisions Lago billing for a new organization.
 */
export async function provisionLagoBillingForOrganization(params: {
  organizationId: string
  name: string
  ownerEmail?: string | null
}): Promise<void> {
  await provisionLagoBillingEntity({
    entityType: 'organization',
    entityId: params.organizationId,
    name: params.name,
    email: params.ownerEmail,
    planName: 'free',
  })
}
