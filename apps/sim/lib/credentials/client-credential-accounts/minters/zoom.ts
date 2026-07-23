import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  fetchProvider,
  isTransientProviderStatus,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token'

interface ZoomTokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  api_url?: string
}

/**
 * Maps a parsed Zoom token-endpoint error body to an operator-facing hint for
 * server logs. Zoom returns HTTP 400 for every credential problem, so the
 * `error`/`reason` fields are the only way to tell them apart.
 */
function zoomErrorHint(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: string; reason?: string }
    const haystack = `${parsed.error ?? ''} ${parsed.reason ?? ''}`.toLowerCase()
    if (haystack.includes('invalid_client')) {
      return 'invalid client_id or client_secret'
    }
    if (haystack.includes('unsupported grant type')) {
      return 'app is not a Server-to-Server OAuth app'
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Mints a Zoom Server-to-Server OAuth access token via the
 * `account_credentials` grant: POST https://zoom.us/oauth/token with HTTP
 * Basic auth (client id/secret) and `account_id` = the S2S app's Account ID.
 * Tokens live one hour, there is no refresh token, and Zoom allows multiple
 * concurrently valid tokens — re-mint instead of refreshing.
 *
 * Zoom reports every credential failure as HTTP 400 (invalid_client, bad
 * account_id, unsupported grant type, deactivated app), so 4xx maps to
 * `invalid_credentials` — except transient 429/408 throttling statuses, which
 * map to `provider_unavailable` alongside 5xx/network failures (never blame
 * the credentials for provider-side throttling).
 */
export async function mintZoomServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const basicAuth = Buffer.from(`${fields.clientId}:${fields.clientSecret}`).toString('base64')
  const res = await fetchProvider(
    ZOOM_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'account_credentials',
        account_id: fields.orgId,
      }).toString(),
    },
    'zoom_token_mint'
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status >= 400 && res.status < 500 && !isTransientProviderStatus(res.status)) {
      const hint = zoomErrorHint(body)
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: 'zoom_token_mint',
        body,
        ...(hint ? { hint } : {}),
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: 'zoom_token_mint',
      body,
    })
  }

  const payload = await parseProviderJson<ZoomTokenResponse>(res, 'zoom_token_mint')
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'zoom_token_mint',
      reason: 'token response missing access_token',
    })
  }

  const grantedScopes =
    typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : undefined

  if (options?.skipIdentity) {
    return {
      accessToken: payload.access_token,
      expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
      grantedScopes,
    }
  }

  const storedMetadata: Record<string, string> = {}
  if (typeof payload.api_url === 'string' && payload.api_url) {
    storedMetadata.apiUrl = payload.api_url
  }
  if (grantedScopes?.length) {
    storedMetadata.grantedScopes = grantedScopes.join(' ')
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
    grantedScopes,
    identity: {
      displayName: `Zoom account ${fields.orgId}`,
      auditMetadata: { zoomAccountId: fields.orgId, zoomClientId: fields.clientId },
      ...(Object.keys(storedMetadata).length > 0 ? { storedMetadata } : {}),
    },
  }
}
