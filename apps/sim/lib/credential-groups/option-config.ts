import {
  type CredentialGroupOAuthOptionConfig,
  type CredentialGroupOptionConfig,
  isCredentialGroupApiKeyOptionConfig,
} from '@sim/db/schema'

/**
 * Narrows a stored option to the OAuth member.
 *
 * The OAuth enrollment path — authorization URLs, token exchange, scope policy comparison,
 * reconnect detection — is meaningless for an option enrolled by pasting a key, so reaching
 * it with one is a routing bug. Throwing surfaces that at the boundary instead of letting
 * `undefined` scopes flow into a policy comparison that would silently mark every credential
 * as needing reauthorization.
 */
export function requireCredentialGroupOAuthOptionConfig(
  option: CredentialGroupOptionConfig
): CredentialGroupOAuthOptionConfig {
  if (isCredentialGroupApiKeyOptionConfig(option)) {
    throw new Error(
      `Credential Group option ${option.id} enrolls with an API key and has no OAuth policy`
    )
  }
  return option
}
