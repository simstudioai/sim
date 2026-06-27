import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LagoApiError, lagoRequest } from '@/lib/billing/lago/client'
import { toLagoCustomerExternalId } from '@/lib/billing/lago/external-ids'
import { getLagoProductSlug } from '@/lib/billing/lago/product'
import type { LagoBillingEntityType } from '@/lib/billing/lago/types'
import { env, envNumber } from '@/lib/core/config/env'

const logger = createLogger('LagoWallets')

const DEFAULT_GRANTED_CREDITS = envNumber(env.LAGO_SIGNUP_GRANTED_CREDITS, 20)

interface LagoWalletPayload {
  wallet: {
    external_customer_id: string
    rate_amount: string
    currency: string
    name: string
    code: string
    granted_credits?: string
    paid_credits?: string
    recurring_transaction_rules?: Array<{
      trigger: string
      method: string
      target_ongoing_balance: string
      threshold_credits: string
      paid_credits: string
      granted_credits: string
    }>
  }
}

/**
 * Ensures a prepaid wallet exists for a billing entity (idempotent).
 */
export async function ensureLagoWallet(
  entityType: LagoBillingEntityType,
  entityId: string
): Promise<void> {
  const slug = getLagoProductSlug()
  if (!slug) return

  const externalCustomerId = toLagoCustomerExternalId(entityType, entityId)
  const walletCode = `${slug}_wallet`
  const payload: LagoWalletPayload = {
    wallet: {
      external_customer_id: externalCustomerId,
      rate_amount: '1',
      currency: 'USD',
      name: `${slug} credits`,
      code: walletCode,
      granted_credits: String(DEFAULT_GRANTED_CREDITS),
      paid_credits: '0',
      recurring_transaction_rules: [
        {
          trigger: 'threshold',
          method: 'target',
          target_ongoing_balance: '20',
          threshold_credits: '5',
          paid_credits: '0',
          granted_credits: '0',
        },
      ],
    },
  }

  try {
    await lagoRequest('POST', '/wallets', payload)
    logger.info('Created Lago wallet', { externalCustomerId, walletCode })
  } catch (error) {
    if (error instanceof LagoApiError && (error.status === 422 || error.status === 400)) {
      logger.debug('Lago wallet already exists', { externalCustomerId, walletCode })
      return
    }
    logger.warn('Failed to create Lago wallet', {
      externalCustomerId,
      error: getErrorMessage(error),
    })
  }

  try {
    await lagoRequest(
      'POST',
      `/customers/${encodeURIComponent(externalCustomerId)}/wallets/${walletCode}/alerts`,
      {
        alert: {
          alert_type: 'wallet_credits_ongoing_balance',
          code: 'low_balance',
          name: 'Low balance',
          thresholds: [{ code: 'low', value: '5' }],
        },
      }
    )
  } catch (error) {
    if (error instanceof LagoApiError && (error.status === 422 || error.status === 400)) {
      return
    }
    logger.warn('Failed to create Lago wallet alert', {
      externalCustomerId,
      error: getErrorMessage(error),
    })
  }
}

interface LagoWalletListResponse {
  wallets: Array<{
    lago_id: string
    external_customer_id: string
    code: string | null
    status: string
    credits_balance: string | number
    balance_cents: number
  }>
}

interface LagoWalletInfo {
  lagoId: string
  creditsBalance: number
}

/**
 * Fetches the active prepaid wallet for a billing entity, or `null` when none exists.
 */
export async function getLagoWallet(
  entityType: LagoBillingEntityType,
  entityId: string
): Promise<LagoWalletInfo | null> {
  const slug = getLagoProductSlug()
  if (!slug) return null

  const externalCustomerId = toLagoCustomerExternalId(entityType, entityId)
  const walletCode = `${slug}_wallet`

  try {
    const response = await lagoRequest<LagoWalletListResponse>(
      'GET',
      `/wallets?external_customer_id=${encodeURIComponent(externalCustomerId)}&per_page=50`
    )
    const wallets = response.wallets ?? []
    const wallet =
      wallets.find((w) => w.code === walletCode && w.status === 'active') ??
      wallets.find((w) => w.status === 'active') ??
      wallets[0]
    if (!wallet) return null
    return { lagoId: wallet.lago_id, creditsBalance: Number(wallet.credits_balance ?? 0) }
  } catch (error) {
    logger.warn('Failed to read Lago wallet', {
      externalCustomerId,
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * Returns the funded credit balance of the entity's Lago wallet (1 credit = $1),
 * or `null` when the wallet is unavailable.
 */
export async function getLagoWalletBalance(
  entityType: LagoBillingEntityType,
  entityId: string
): Promise<number | null> {
  const wallet = await getLagoWallet(entityType, entityId)
  return wallet ? wallet.creditsBalance : null
}

/**
 * Adds paid credits to the entity's Lago wallet. Creates the wallet first when missing.
 * Returns `true` on success.
 */
export async function topUpLagoWallet(
  entityType: LagoBillingEntityType,
  entityId: string,
  credits: number
): Promise<boolean> {
  if (credits <= 0) return false

  let wallet = await getLagoWallet(entityType, entityId)
  if (!wallet) {
    await ensureLagoWallet(entityType, entityId)
    wallet = await getLagoWallet(entityType, entityId)
  }
  if (!wallet) {
    logger.warn('Cannot top up Lago wallet — wallet not found', { entityType, entityId })
    return false
  }

  try {
    // Use granted_credits (settles immediately) rather than paid_credits, which
    // would create an invoice that requires a linked payment provider to settle.
    // This deployment bills usage pay-as-you-go via metered invoices, so wallet
    // top-ups are granted directly.
    await lagoRequest('POST', '/wallet_transactions', {
      wallet_transaction: {
        wallet_id: wallet.lagoId,
        granted_credits: String(credits),
        paid_credits: '0',
      },
    })
    logger.info('Topped up Lago wallet', { entityType, entityId, credits })
    return true
  } catch (error) {
    logger.error('Failed to top up Lago wallet', {
      entityType,
      entityId,
      credits,
      error: getErrorMessage(error),
    })
    return false
  }
}
