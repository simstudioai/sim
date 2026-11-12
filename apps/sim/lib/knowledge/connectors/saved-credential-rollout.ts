import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ConnectorAuthConfig } from '@/connectors/types'

/**
 * Whether a key-based connector may be set up with its saved-credential alternative.
 *
 * A global switch that gates setup only. Workers from an older release read a key
 * connector without a key as one whose credential was removed and unschedule it, so
 * the switch stays off until every app and worker runs a release that reads these rows.
 * Turning it off later does not protect rows already set up: once any exist, a release
 * rollback unschedules them as credential-removed, and they stay idle until edited or
 * synced manually.
 */
export function isConnectorSavedCredentialSetupEnabled(): Promise<boolean> {
  return isFeatureEnabled('knowledge-connector-saved-credentials')
}

/** Refuses to bind a saved credential to a key-based connector while setup is not enabled. */
export async function requireConnectorSavedCredentialSetup(
  auth: ConnectorAuthConfig,
  credentialId: string | null | undefined
): Promise<void> {
  if (auth.mode !== 'apiKey' || !auth.savedCredential || !credentialId) return
  if (!(await isConnectorSavedCredentialSetupEnabled())) {
    throw new OrchestrationError(
      'validation',
      'This source cannot use a saved credential yet. Use its API key instead.'
    )
  }
}
