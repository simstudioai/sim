import { awsApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/aws'
import { firefliesApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/fireflies'
import { grainApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/grain'
import { granolaApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/granola'
import type { CredentialGroupApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/types'
import type { CredentialGroupApiKeyProvider } from '@/lib/credential-groups/providers'

/**
 * Keyed by the full API-key provider union, so adding a provider id without a verifier is a
 * compile error rather than a runtime one at enrollment time.
 */
const CREDENTIAL_GROUP_API_KEY_VERIFIERS: Record<
  CredentialGroupApiKeyProvider,
  CredentialGroupApiKeyVerifier
> = {
  aws: awsApiKeyVerifier,
  fireflies: firefliesApiKeyVerifier,
  grain: grainApiKeyVerifier,
  granola: granolaApiKeyVerifier,
}

export function getCredentialGroupApiKeyVerifier(
  provider: CredentialGroupApiKeyProvider
): CredentialGroupApiKeyVerifier {
  return CREDENTIAL_GROUP_API_KEY_VERIFIERS[provider]
}
