import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { getOAuth2Tokens } from 'better-auth/oauth2'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

const logger = createLogger('AtlassianOAuth')
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'

interface ExchangeAtlassianAuthorizationCodeInput {
  provider: 'jira' | 'confluence'
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  codeVerifier?: string
}

/** Atlassian's 3LO token endpoint requires client credentials in a JSON request body. */
export async function exchangeAtlassianAuthorizationCode({
  provider,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}: ExchangeAtlassianAuthorizationCodeInput) {
  const response = await fetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
    maxBytes: 1024 * 1024,
    label: 'Atlassian OAuth token response',
  })
  if (!response.ok || !isRecordLike(data)) {
    logger.warn('Atlassian OAuth token exchange failed', { provider, status: response.status })
    throw new Error(`Atlassian OAuth token exchange failed with HTTP ${response.status}`)
  }

  const tokens = getOAuth2Tokens(data)
  if (!tokens.accessToken) {
    throw new Error('Atlassian OAuth token response did not include an access token')
  }
  tokens.tokenType ??= 'Bearer'
  return tokens
}
