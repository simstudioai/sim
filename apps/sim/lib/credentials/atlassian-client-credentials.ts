import { exchangeClientCredentialsGrant } from '@/lib/credentials/client-credentials-grant'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const MINT_STEP = 'atlassian_token_mint'
/** Atlassian documents a 60-minute access token for service-account OAuth credentials. */
const MAX_TOKEN_LIFETIME_SECONDS = 3600

/**
 * Mints a bearer token for an Atlassian service account's OAuth 2.0 credential through the
 * client-credentials grant. The token is used exactly like a scoped API token, through
 * `api.atlassian.com/ex/{product}/{cloudId}`. Atlassian documents these credentials for the Jira
 * and Confluence REST APIs (not Jira Service Management, which shares Jira's credentials here),
 * and does not document whether a new token retires earlier ones, so every saved credential for
 * one OAuth client shares a single coordinated token instead of minting per worker.
 *
 * @see https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/
 */
export async function mintAtlassianServiceAccountToken(
  clientId: string,
  clientSecret: string,
  options?: { signal?: AbortSignal }
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  if (!clientId || !clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: MINT_STEP,
      reason: 'client ID and client secret are required',
    })
  }
  return resolveCoordinatedClientToken({
    namespace: 'atlassian',
    application: [clientId],
    clientSecret,
    step: MINT_STEP,
    exchange: (signal) =>
      exchangeClientCredentialsGrant({
        url: ATLASSIAN_TOKEN_URL,
        clientId,
        clientSecret,
        step: MINT_STEP,
        label: 'Atlassian token response',
        maxLifetimeSeconds: MAX_TOKEN_LIFETIME_SECONDS,
        signal,
      }),
    signal: options?.signal,
  })
}
