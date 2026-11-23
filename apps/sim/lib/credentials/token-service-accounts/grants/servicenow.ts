import { exchangeClientCredentialsGrant } from '@/lib/credentials/client-credentials-grant'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import type {
  TokenClientCredentialFields,
  TokenClientCredentialMint,
} from '@/lib/credentials/token-service-accounts/client-credentials'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { normalizeServiceNowInstanceUrl } from '@/lib/credentials/token-service-accounts/validators/token-checks'

const STEP = 'servicenow_token_mint'
/**
 * ServiceNow's default access token lifespan is 30 minutes and an admin sets it per OAuth
 * application, so the reported `expires_in` is honored up to a day.
 */
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60

/** The instance origin the grant and every tool call use, exactly as the login check stores it. */
function instanceOrigin(domain: string | undefined): string {
  try {
    return normalizeServiceNowInstanceUrl(domain)
  } catch {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      reason: 'instance URL is not an https URL',
    })
  }
}

/**
 * Mints an access token for an inbound OAuth client through the client-credentials grant at the
 * instance's `oauth_token.do`. The instance must turn the grant on with the
 * `glide.oauth.inbound.client.credential.grant_type.enabled` system property, and the token acts as
 * the OAuth Application User on the client's registry entry. The instance is any public https host
 * (the same rule the username and password login follows), so the request goes through the
 * configured-endpoint egress guard. ServiceNow answers a request made while a token is still valid
 * with that token, so every saved credential for one client on one instance shares one coordinated
 * token.
 *
 * @see https://www.servicenow.com/docs/r/xanadu/platform-security/authentication/client-credentials.html
 * @see https://www.servicenow.com/docs/r/washingtondc/platform-security/authentication/r_OAuthAPIRequestParameters.html
 */
export async function mintServiceNowClientCredentialsToken(
  fields: TokenClientCredentialFields,
  options?: { signal?: AbortSignal }
): Promise<TokenClientCredentialMint> {
  options?.signal?.throwIfAborted()
  const origin = instanceOrigin(fields.domain)
  const clientId = fields.clientId.trim()
  if (!clientId || !fields.clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'client ID and client secret are required',
    })
  }
  return resolveCoordinatedClientToken({
    namespace: 'servicenow',
    application: [origin, clientId],
    clientSecret: fields.clientSecret,
    step: STEP,
    exchange: (signal) =>
      exchangeClientCredentialsGrant({
        url: `${origin}/oauth_token.do`,
        clientId,
        clientSecret: fields.clientSecret,
        step: STEP,
        label: 'ServiceNow token response',
        maxLifetimeSeconds: MAX_TOKEN_LIFETIME_SECONDS,
        egress: 'configuredEndpoint',
        signal,
      }),
    signal: options?.signal,
  })
}
