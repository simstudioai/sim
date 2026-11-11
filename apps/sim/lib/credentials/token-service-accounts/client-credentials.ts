import {
  isTokenServiceAccountProviderId,
  SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  type TokenServiceAccountProviderId,
} from '@/lib/credentials/token-service-accounts/descriptors'
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

export type TokenClientCredentialMinter = (
  fields: TokenClientCredentialFields,
  options?: { signal?: AbortSignal }
) => Promise<TokenClientCredentialMint>

export interface TokenClientCredentialGrant {
  mint: TokenClientCredentialMinter
  /**
   * The minter keeps one token per provider application across every worker itself, so the
   * resolver must not cache its tokens per instance. Set for providers that do not document
   * whether a new token leaves earlier ones valid.
   */
  sharedToken: boolean
}

/**
 * Client-credentials grants offered beside the pasted token, for token providers whose
 * descriptor declares `clientCredentials`. The pasted-token mode is unchanged; a credential uses
 * the grant only when it was saved with `authMethod: 'client_credentials'`.
 */
const TOKEN_CLIENT_CREDENTIAL_GRANTS: Partial<
  Record<TokenServiceAccountProviderId, TokenClientCredentialGrant>
> = {
  [SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    mint: mintShopifyClientCredentialsToken,
    sharedToken: true,
  },
}

export function getTokenClientCredentialGrant(
  providerId: string
): TokenClientCredentialGrant | undefined {
  return isTokenServiceAccountProviderId(providerId)
    ? TOKEN_CLIENT_CREDENTIAL_GRANTS[providerId]
    : undefined
}
