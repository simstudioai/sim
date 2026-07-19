import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { LagoApiError, lagoRequest } from '@/lib/billing/lago/client'
import { mapLagoPlanToSimPlan, mapSimPlanToLagoPlan } from '@/lib/billing/lago/config'
import {
  toLagoCustomerExternalId,
  toLagoSubscriptionExternalId,
} from '@/lib/billing/lago/external-ids'
import type {
  LagoBillingEntityType,
  LagoSubscriptionPayload,
  LagoSubscriptionResponse,
} from '@/lib/billing/lago/types'
import { handleSubscriptionCreated } from '@/lib/billing/webhooks/subscription'

const logger = createLogger('LagoSubscriptions')

export function mapLagoStatusToSimStatus(lagoStatus: string): string {
  switch (lagoStatus) {
    case 'active':
      return 'active'
    case 'pending':
      return 'incomplete'
    case 'terminated':
    case 'canceled':
      return 'canceled'
    default:
      return lagoStatus
  }
}

function parseLagoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

interface EnsureLocalSubscriptionParams {
  entityType: LagoBillingEntityType
  entityId: string
  planName: string
  lagoCustomerId?: string | null
  lagoSubscriptionId: string
  subscriptionExternalId: string
  status: string
  periodStart?: Date | null
  periodEnd?: Date | null
}

/**
 * Upserts the local `subscription` row from a Lago subscription snapshot.
 */
export async function upsertLocalSubscriptionFromLago(
  params: EnsureLocalSubscriptionParams
): Promise<void> {
  const referenceId = params.entityId
  const now = new Date()

  const existing = await db
    .select()
    .from(subscription)
    .where(eq(subscription.id, params.subscriptionExternalId))
    .limit(1)

  const row = {
    plan: params.planName,
    referenceId,
    stripeCustomerId: null,
    stripeSubscriptionId: params.lagoSubscriptionId,
    lagoCustomerId: params.lagoCustomerId ?? null,
    lagoSubscriptionId: params.lagoSubscriptionId,
    billingProvider: 'lago',
    status: mapLagoStatusToSimStatus(params.status),
    periodStart: params.periodStart ?? now,
    periodEnd: params.periodEnd,
    cancelAtPeriodEnd: false,
    metadata: {
      billingProvider: 'lago',
      lagoSubscriptionId: params.lagoSubscriptionId,
      lagoExternalId: params.subscriptionExternalId,
    },
  }

  if (existing.length > 0) {
    await db.update(subscription).set(row).where(eq(subscription.id, params.subscriptionExternalId))
  } else {
    await db.insert(subscription).values({
      id: params.subscriptionExternalId,
      ...row,
    })
  }

  const sub = await db
    .select()
    .from(subscription)
    .where(eq(subscription.id, params.subscriptionExternalId))
    .limit(1)

  if (sub[0]) {
    await syncUsageLimitsFromSubscription(sub[0].referenceId)
  }
}

/**
 * Creates a Lago subscription and mirrors it into the local DB.
 */
export async function createLagoSubscription(params: {
  entityType: LagoBillingEntityType
  entityId: string
  planName: string
  subscriptionExternalId?: string
  lagoCustomerId?: string | null
}): Promise<LagoSubscriptionResponse['subscription']> {
  const planCode = mapSimPlanToLagoPlan(params.planName)
  if (!planCode) {
    throw new Error(`No Lago plan configured for Sim plan ${params.planName}`)
  }

  const subscriptionExternalId =
    params.subscriptionExternalId ??
    toLagoSubscriptionExternalId(params.entityType, params.entityId) ??
    generateId()
  const payload: { subscription: LagoSubscriptionPayload } = {
    subscription: {
      external_customer_id: toLagoCustomerExternalId(params.entityType, params.entityId),
      plan_code: planCode,
      external_id: subscriptionExternalId,
      billing_time: 'anniversary',
    },
  }

  let lagoSub: LagoSubscriptionResponse['subscription']
  try {
    const response = await lagoRequest<LagoSubscriptionResponse>('POST', '/subscriptions', payload)
    lagoSub = response.subscription
  } catch (error) {
    if (error instanceof LagoApiError && error.status === 422) {
      const existing = await lagoRequest<LagoSubscriptionResponse>(
        'GET',
        `/subscriptions/${encodeURIComponent(subscriptionExternalId)}`
      )
      lagoSub = existing.subscription
    } else {
      throw error
    }
  }

  await upsertLocalSubscriptionFromLago({
    entityType: params.entityType,
    entityId: params.entityId,
    planName: mapLagoPlanToSimPlan(lagoSub.plan_code),
    lagoCustomerId: params.lagoCustomerId,
    lagoSubscriptionId: lagoSub.lago_id,
    subscriptionExternalId,
    status: lagoSub.status,
    periodStart: parseLagoDate(lagoSub.current_billing_period_started_at ?? lagoSub.started_at),
    periodEnd: parseLagoDate(lagoSub.current_billing_period_ending_at),
  })

  await handleSubscriptionCreated({
    id: subscriptionExternalId,
    referenceId: params.entityId,
    plan: mapLagoPlanToSimPlan(lagoSub.plan_code),
    status: mapLagoStatusToSimStatus(lagoSub.status),
    periodStart: parseLagoDate(lagoSub.current_billing_period_started_at ?? lagoSub.started_at),
    periodEnd: parseLagoDate(lagoSub.current_billing_period_ending_at),
  })

  return lagoSub
}

/**
 * Terminates other active subscriptions for the same billing entity before upgrading.
 */
export async function terminateOtherLagoSubscriptions(
  entityId: string,
  keepSubscriptionId: string
): Promise<void> {
  const rows = await db
    .select({ id: subscription.id, stripeSubscriptionId: subscription.stripeSubscriptionId })
    .from(subscription)
    .where(and(eq(subscription.referenceId, entityId), eq(subscription.status, 'active')))

  for (const row of rows) {
    if (row.id === keepSubscriptionId) continue
    if (!row.stripeSubscriptionId) continue
    try {
      await lagoRequest('DELETE', `/subscriptions/${encodeURIComponent(row.id)}`)
      await db
        .update(subscription)
        .set({ status: 'canceled', endedAt: new Date() })
        .where(eq(subscription.id, row.id))
    } catch (error) {
      logger.warn('Failed to terminate superseded Lago subscription', {
        subscriptionId: row.id,
        error,
      })
    }
  }
}

/**
 * Switches an existing Lago subscription to a new plan.
 */
export async function switchLagoSubscriptionPlan(params: {
  subscriptionExternalId: string
  targetPlanName: string
}): Promise<void> {
  const planCode = mapSimPlanToLagoPlan(params.targetPlanName)
  if (!planCode) {
    throw new Error(`No Lago plan configured for Sim plan ${params.targetPlanName}`)
  }

  const response = await lagoRequest<LagoSubscriptionResponse>(
    'PUT',
    `/subscriptions/${encodeURIComponent(params.subscriptionExternalId)}`,
    {
      subscription: {
        plan_code: planCode,
      },
    }
  )

  const sub = response.subscription
  const entity = await db
    .select()
    .from(subscription)
    .where(eq(subscription.id, params.subscriptionExternalId))
    .limit(1)

  if (entity.length === 0) return

  await upsertLocalSubscriptionFromLago({
    entityType: entity[0].referenceId.startsWith('org_') ? 'organization' : 'user',
    entityId: entity[0].referenceId,
    planName: mapLagoPlanToSimPlan(sub.plan_code),
    lagoSubscriptionId: sub.lago_id,
    subscriptionExternalId: params.subscriptionExternalId,
    status: sub.status,
    periodStart: parseLagoDate(sub.current_billing_period_started_at ?? sub.started_at),
    periodEnd: parseLagoDate(sub.current_billing_period_ending_at),
  })
}
