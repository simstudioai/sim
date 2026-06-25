import { isEnterprise } from '@/lib/billing/plan-helpers'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const isBillingEnabledClient = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
const isForkingEnabledClient = isTruthy(getEnv('NEXT_PUBLIC_FORKING_ENABLED'))

/**
 * Client mirror of the server fork EE gate (`assertForkingEnabled`): the
 * Enterprise plan on Sim Cloud, or the `NEXT_PUBLIC_FORKING_ENABLED` override on
 * self-hosted. Used to hide the fork UI (and skip the lineage query) for
 * workspaces that cannot fork. The server gate remains the security boundary.
 */
export function useForkingAvailable(): boolean {
  const { data } = useSubscriptionData()
  if (!isBillingEnabledClient) return isForkingEnabledClient
  return isEnterprise(data?.data?.plan)
}
