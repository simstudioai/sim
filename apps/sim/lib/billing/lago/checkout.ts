import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getLagoCheckoutUrl } from '@/lib/billing/lago/customers'
import { toLagoSubscriptionExternalId } from '@/lib/billing/lago/external-ids'
import {
  createLagoSubscription,
  terminateOtherLagoSubscriptions,
} from '@/lib/billing/lago/subscriptions'
import type { LagoBillingEntityType } from '@/lib/billing/lago/types'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('LagoCheckout')

export interface CreateLagoCheckoutParams {
  entityType: LagoBillingEntityType
  entityId: string
  planName: string
  seats?: number
  successUrl?: string
  cancelUrl?: string
}

export interface CreateLagoCheckoutResult {
  checkoutUrl: string
  subscriptionExternalId: string
}

/**
 * Creates a paid Lago subscription and returns a checkout URL for payment method setup.
 */
export async function createLagoCheckout(
  params: CreateLagoCheckoutParams
): Promise<CreateLagoCheckoutResult> {
  const subscriptionExternalId =
    toLagoSubscriptionExternalId(params.entityType, params.entityId) ?? generateId()

  await terminateOtherLagoSubscriptions(params.entityId, subscriptionExternalId)

  await createLagoSubscription({
    entityType: params.entityType,
    entityId: params.entityId,
    planName: params.planName,
    subscriptionExternalId,
  })

  const checkoutUrl = await getLagoCheckoutUrl(params.entityType, params.entityId)
  if (!checkoutUrl) {
    const fallback = params.successUrl ?? `${getBaseUrl()}/workspace?upgraded=true`
    logger.warn('Lago checkout URL unavailable, returning success URL fallback', {
      entityId: params.entityId,
      planName: params.planName,
    })
    return { checkoutUrl: fallback, subscriptionExternalId }
  }

  const url = new URL(checkoutUrl)
  if (params.successUrl) {
    url.searchParams.set('success_url', params.successUrl)
  }
  if (params.cancelUrl) {
    url.searchParams.set('cancel_url', params.cancelUrl)
  }

  return {
    checkoutUrl: url.toString(),
    subscriptionExternalId,
  }
}

export async function safeCreateLagoCheckout(
  params: CreateLagoCheckoutParams
): Promise<CreateLagoCheckoutResult> {
  try {
    return await createLagoCheckout(params)
  } catch (error) {
    logger.error('Lago checkout failed', {
      entityId: params.entityId,
      planName: params.planName,
      error: getErrorMessage(error),
    })
    throw error
  }
}
