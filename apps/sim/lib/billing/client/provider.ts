import { env } from '@/lib/core/config/env'

/** Client-side billing provider (must match server `BILLING_PROVIDER`). */
export function isLagoBillingClient(): boolean {
  return env.NEXT_PUBLIC_BILLING_PROVIDER === 'lago'
}

/** i18n key for the hosted billing portal button label. */
export function getBillingPortalLabelKey(): 'manage_in_aacbilling' | 'manage_in_stripe' {
  return isLagoBillingClient() ? 'manage_in_aacbilling' : 'manage_in_stripe'
}
