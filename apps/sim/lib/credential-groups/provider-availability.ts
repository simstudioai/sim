import { inspectConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  type CredentialGroupProvider,
  getCredentialGroupProviderId,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'

/**
 * The providers this deployment can actually enroll.
 *
 * A standard OAuth provider needs Sim's own OAuth client for that service to be configured;
 * without it the connector is never built and starting an enrollment fails with a configuration
 * error. Offering the option anyway leaves an admin with a row that only reports its own
 * unavailability after they have already added it to a group and invited somebody.
 *
 * Slack is exempt because its credential is the workspace's own custom bot, configured per group
 * after the fact — its readiness is already surfaced by the option's `configurationStatus`.
 *
 * Server-only: `inspectConfiguredOAuthClient` reads the server environment.
 */
export function listConfiguredCredentialGroupProviders(): CredentialGroupProvider[] {
  return CREDENTIAL_GROUP_PROVIDER_IDS.filter((provider) => {
    if (!isCredentialGroupStandardOAuthProvider(provider)) return true
    return inspectConfiguredOAuthClient(getCredentialGroupProviderId(provider)).state === 'ready'
  })
}
