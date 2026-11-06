import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import { isFree } from '@/lib/billing/plan-helpers'
import type { UsageUpgradePayer } from '@/lib/billing/usage-upgrade'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

const logger = createLogger('ChatAccess')

/**
 * Whether a payer may use Chat (talking to Sim). Every turn spends hosted model credits, so a
 * hosted deployment that bills withholds Chat from a payer on the free plan — unless that payer
 * holds prepaid credits, which an admin grants to customers billed outside a subscription.
 *
 * The plan is the payer's entitled subscription (active or past due), so a canceled
 * plan reads as free; a blocked payer is refused by the usage check every caller runs next.
 *
 * This is the single verdict behind every Chat plan gate: run admission, chat titles, scheduled
 * job dispatch, Copilot key admission, and the workspace host context the composer reads, so the
 * composer never offers a send that admission will refuse. A balance that cannot be read admits
 * the payer: a database blip must not lock a paying customer out, and a free payer stays bounded
 * by its usage limit.
 */
export async function payerHasChatAccess(payer: UsageUpgradePayer): Promise<boolean> {
  if (!isHosted || !isBillingEnabled) return true
  if (!isFree(payer.payerSubscription?.plan)) return true
  try {
    const balance = await getCreditBalanceForEntity(
      payer.billingEntity.type,
      payer.billingEntity.id
    )
    return balance > 0
  } catch (error) {
    logger.warn('Credit balance unavailable; admitting the payer to Chat', {
      billingEntity: payer.billingEntity,
      error: getErrorMessage(error),
    })
    return true
  }
}
