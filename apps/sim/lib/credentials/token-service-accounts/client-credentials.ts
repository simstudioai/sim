import {
  isTokenServiceAccountProviderId,
  LINEAR_SERVICE_ACCOUNT_PROVIDER_ID,
  SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  type TokenServiceAccountProviderId,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { mintLinearClientCredentialsToken } from '@/lib/credentials/token-service-accounts/grants/linear'
import { mintShopifyClientCredentialsToken } from '@/lib/credentials/token-service-accounts/grants/shopify'

/** What a token provider's client-credentials grant needs to mint an access token. */
export interface TokenClientCredentialFields {
  clientId: string
  clientSecret: string
  /** The normalized account host, for providers whose token endpoint is per account (Shopify). */
  domain?: string
}

export interface TokenClientCredentialMint {
  accessToken: string
  expiresInSeconds: number
}

type TokenClientCredentialMinter = (
  fields: TokenClientCredentialFields,
  options?: { signal?: AbortSignal }
) => Promise<TokenClientCredentialMint>

/**
 * Client-credentials grants offered beside the pasted token, for token providers whose
 * descriptor declares `clientCredentials`. The pasted-token mode is unchanged; a credential uses
 * the grant only when it was saved with `authMethod: 'client_credentials'`. Every minter keeps
 * one token per provider application across all workers itself (see
 * `resolveCoordinatedClientToken`), so its tokens are never cached per instance.
 */
const TOKEN_CLIENT_CREDENTIAL_MINTERS: Partial<
  Record<TokenServiceAccountProviderId, TokenClientCredentialMinter>
> = {
  [SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID]: mintShopifyClientCredentialsToken,
  [LINEAR_SERVICE_ACCOUNT_PROVIDER_ID]: mintLinearClientCredentialsToken,
}

export function getTokenClientCredentialMinter(
  providerId: string
): TokenClientCredentialMinter | undefined {
  return isTokenServiceAccountProviderId(providerId)
    ? TOKEN_CLIENT_CREDENTIAL_MINTERS[providerId]
    : undefined
}
