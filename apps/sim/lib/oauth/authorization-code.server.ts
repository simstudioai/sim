import { toRecord } from '@sim/utils/object'
import {
  authorizationCodeRequest,
  getOAuth2Tokens,
  type OAuth2Tokens,
  type validateAuthorizationCode,
} from 'better-auth/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { isRedirectStatus } from '@/lib/core/security/input-validation.server'

type AuthorizationCodeExchange = Parameters<typeof validateAuthorizationCode>[0]
type GetToken = NonNullable<GenericOAuthConfig['getToken']>

const JSON_MEDIA_TYPE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json$/i
const TEXT_MEDIA_TYPES = new Set([
  'image/svg',
  'application/xml',
  'application/xhtml',
  'application/html',
])

/**
 * Reads a successful response the way Better Auth's `betterFetch` does: JSON and text bodies are
 * JSON-parsed when they parse (else kept as text), anything else is a Blob.
 */
async function readResponseData(response: Response): Promise<unknown> {
  const mediaType = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (
    !mediaType ||
    JSON_MEDIA_TYPE.test(mediaType) ||
    TEXT_MEDIA_TYPES.has(mediaType) ||
    mediaType.startsWith('text/')
  ) {
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return response.blob()
}

/**
 * Better Auth's `validateAuthorizationCode`, sent through {@link outboundFetch} so the code
 * exchange leaves through the current outbound scope's egress route. The request is built by
 * Better Auth's own `authorizationCodeRequest` and the response parsed by its `getOAuth2Tokens`;
 * like Better Auth, it refuses redirects and throws on a non-2xx answer.
 */
export async function exchangeAuthorizationCode({
  tokenEndpoint,
  ...request
}: AuthorizationCodeExchange): Promise<OAuth2Tokens> {
  const { body, headers } = await authorizationCodeRequest(request)
  const response = await outboundFetch(tokenEndpoint, {
    method: 'POST',
    body,
    headers,
    redirect: 'manual',
  })
  const redirected = response.type === 'opaqueredirect' || isRedirectStatus(response.status)
  if (redirected || !response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(
      redirected
        ? `The OAuth endpoint "${tokenEndpoint}" returned an HTTP redirect`
        : `OAuth token endpoint responded with ${response.status}`
    )
  }
  return getOAuth2Tokens(toRecord(await readResponseData(response)))
}

/** The plugin's token endpoint: the discovery document's when it answers, else `tokenUrl`. */
async function resolveTokenEndpoint(config: GenericOAuthConfig): Promise<string> {
  let tokenEndpoint = config.tokenUrl
  if (config.discoveryUrl) {
    const response = await outboundFetch(config.discoveryUrl, {
      method: 'GET',
      headers: config.discoveryHeaders,
    })
    if (response.ok) {
      const discovery = await readResponseData(response)
      if (discovery) {
        const endpoint = toRecord(discovery).token_endpoint
        tokenEndpoint = typeof endpoint === 'string' ? endpoint : undefined
      }
    } else {
      await response.body?.cancel().catch(() => {})
    }
  }
  if (!tokenEndpoint) throw new Error(`OAuth token endpoint not found for ${config.providerId}`)
  return tokenEndpoint
}

/**
 * The code exchange Better Auth's generic OAuth callback performs for a connector without its
 * own `getToken` (discovery, client authentication, PKCE verifier, static `tokenUrlParams`), sent
 * through {@link outboundFetch}. Undefined when `tokenUrlParams` reads the callback request,
 * which a `getToken` never sees.
 */
export function createOutboundCodeExchange(config: GenericOAuthConfig): GetToken | undefined {
  const { tokenUrlParams } = config
  if (typeof tokenUrlParams === 'function') return undefined
  return async ({ code, redirectURI, codeVerifier }) =>
    exchangeAuthorizationCode({
      headers: config.authorizationHeaders,
      code,
      codeVerifier,
      redirectURI,
      options: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectURI: config.redirectURI,
      },
      tokenEndpoint: await resolveTokenEndpoint(config),
      authentication: config.authentication,
      additionalParams: tokenUrlParams,
    })
}
