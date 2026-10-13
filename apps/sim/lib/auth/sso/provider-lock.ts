import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

/** Serializes provider mutations and account links across every tenant sharing a provider ID. */
export function lockSsoProvider(tx: DbTransaction, providerId: string): Promise<void> {
  return acquireAdvisoryXactLock(tx, 'sso_provider_mutation', `sso-provider:${providerId}`)
}
