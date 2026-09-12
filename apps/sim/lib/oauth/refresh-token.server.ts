import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  requireOAuthClientCapability,
} from '@/lib/core/config/env-capabilities'
import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import { redactExactSensitiveValues } from '@/lib/core/security/redaction'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'
import {
  GITHUB_TOKEN_URL,
  parseGitHubRepositoriesTokenResponse,
} from '@/lib/oauth/github-repositories'
import { parseInstagramLongLivedToken } from '@/lib/oauth/instagram'
import { MONDAY_OAUTH_TOKEN_URL, resolveMondayAccessTokenExpiresAt } from '@/lib/oauth/monday'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import type { QuickBooksOAuthClientConfig } from '@/lib/oauth/quickbooks-client-config'
import { QUICKBOOKS_TOKEN_URL } from '@/lib/oauth/quickbooks-constants'
import { SALESFORCE_LOGIN_HOSTS } from '@/lib/oauth/salesforce'
import { REDDIT_USER_AGENT } from '@/tools/reddit/constants'

const { fetch: providerFetch } = createSsrfGuardedFetchWithDispatcher({
  profile: 'configuredEndpoint',
})

const logger = createLogger('OAuth')

interface ProviderAuthConfig {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  useBasicAuth: boolean
  additionalHeaders?: Record<string, string>
  supportsRefreshTokenRotation?: boolean
  /**
   * If true, the refresh token is sent in the Authorization header as Bearer token
   * instead of in the request body. Used by Cal.com.
   */
  refreshTokenInAuthHeader?: boolean
  /**
   * If true, the token endpoint expects a JSON body with Content-Type: application/json
   * instead of the default application/x-www-form-urlencoded. Used by Notion.
   */
  useJsonBody?: boolean
  /**
   * Token refresh strategy. `instagram_long_lived` uses Meta's GET
   * `refresh_access_token?grant_type=ig_refresh_token` flow instead of a
   * standard OAuth refresh_token POST.
   */
  refreshStrategy?: 'standard' | 'instagram_long_lived'
  /**
   * Body param name to use for the client identifier instead of the standard `client_id`.
   * TikTok requires `client_key` instead.
   */
  clientIdParamName?: string
}

function getConfiguredClientCredentials<const TCapabilityId extends OAuthClientCapabilityId>(
  providerId: TCapabilityId,
  clientIdField: NoInfer<OAuthClientCapabilityField<TCapabilityId>>,
  clientSecretField?: NoInfer<OAuthClientCapabilityField<TCapabilityId>>
): Pick<ProviderAuthConfig, 'clientId' | 'clientSecret'> {
  const { values } = requireOAuthClientCapability(providerId, env)
  return {
    clientId: values[clientIdField],
    clientSecret: clientSecretField ? values[clientSecretField] : '',
  }
}

/**
 * Get OAuth provider configuration for token refresh
 */
function getProviderAuthConfig(
  provider: string,
  clientOverride?: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'clientSecret'>
): ProviderAuthConfig {
  if (clientOverride && provider !== 'quickbooks') {
    throw new Error(`OAuth client override is not supported for provider ${provider}`)
  }
  switch (provider) {
    case 'google': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'google',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'x': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'x',
        'X_CLIENT_ID',
        'X_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'tiktok': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'tiktok',
        'TIKTOK_CLIENT_ID',
        'TIKTOK_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://open.tiktokapis.com/v2/oauth/token/',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        // TikTok requires `client_key` in the token request body instead of `client_id`.
        clientIdParamName: 'client_key',
      }
    }
    case 'confluence': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'confluence',
        'CONFLUENCE_CLIENT_ID',
        'CONFLUENCE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'jira': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'jira',
        'JIRA_CLIENT_ID',
        'JIRA_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'calcom': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'calcom',
        'CALCOM_CLIENT_ID'
      )
      return {
        tokenEndpoint: 'https://app.cal.com/api/auth/oauth/refreshToken',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        // Cal.com requires refresh token in Authorization header, not body
        refreshTokenInAuthHeader: true,
      }
    }
    case 'airtable': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'airtable',
        'AIRTABLE_CLIENT_ID',
        'AIRTABLE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://airtable.com/oauth2/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'bitbucket': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'bitbucket',
        'BITBUCKET_CLIENT_ID',
        'BITBUCKET_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://bitbucket.org/site/oauth2/access_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'github-repositories': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'github-repositories',
        'GITHUB_APP_CLIENT_ID',
        'GITHUB_APP_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: GITHUB_TOKEN_URL,
        clientId,
        clientSecret,
        useBasicAuth: false,
        additionalHeaders: { Accept: 'application/json' },
        supportsRefreshTokenRotation: true,
      }
    }
    case 'notion': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'notion',
        'NOTION_CLIENT_ID',
        'NOTION_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
        useJsonBody: true,
      }
    }
    case 'microsoft':
    case 'outlook':
    case 'onedrive':
    case 'sharepoint': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'microsoft',
        'MICROSOFT_CLIENT_ID',
        'MICROSOFT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'clickup': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'clickup',
        'CLICKUP_CLIENT_ID',
        'CLICKUP_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.clickup.com/api/v2/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'linear': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'linear',
        'LINEAR_CLIENT_ID',
        'LINEAR_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.linear.app/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'attio': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'attio',
        'ATTIO_CLIENT_ID',
        'ATTIO_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://app.attio.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'box': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'box',
        'BOX_CLIENT_ID',
        'BOX_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.box.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        // Box refresh tokens are single-use: "the Refresh Token is invalidated and a
        // new Refresh Token is returned" and "A Refresh Token is valid for 60 days and
        // can be used to obtain a new Access Token and Refresh Token only once."
        // (developer.box.com/guides/authentication/tokens/refresh). Without rotation the
        // new token is discarded and the credential dies on the second refresh.
        supportsRefreshTokenRotation: true,
      }
    }
    case 'docusign': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'docusign',
        'DOCUSIGN_CLIENT_ID',
        'DOCUSIGN_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: getDocusignOAuthUrl('/oauth/token'),
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'dropbox': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'dropbox',
        'DROPBOX_CLIENT_ID',
        'DROPBOX_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'slack': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'slack',
        'SLACK_CLIENT_ID',
        'SLACK_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'reddit': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'reddit',
        'REDDIT_CLIENT_ID',
        'REDDIT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://www.reddit.com/api/v1/access_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        additionalHeaders: {
          'User-Agent': REDDIT_USER_AGENT,
        },
      }
    }
    case 'wealthbox': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'wealthbox',
        'WEALTHBOX_CLIENT_ID',
        'WEALTHBOX_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://app.crmworkspace.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'webflow': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'webflow',
        'WEBFLOW_CLIENT_ID',
        'WEBFLOW_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.webflow.com/oauth/access_token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'asana': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'asana',
        'ASANA_CLIENT_ID',
        'ASANA_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://app.asana.com/-/oauth_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'pipedrive': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'pipedrive',
        'PIPEDRIVE_CLIENT_ID',
        'PIPEDRIVE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://oauth.pipedrive.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'quickbooks': {
      if (!clientOverride) {
        throw new Error('QuickBooks OAuth client configuration is missing')
      }
      return {
        tokenEndpoint: QUICKBOOKS_TOKEN_URL,
        clientId: clientOverride.clientId,
        clientSecret: clientOverride.clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'hubspot': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'hubspot',
        'HUBSPOT_CLIENT_ID',
        'HUBSPOT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.hubapi.com/oauth/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'linkedin': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'linkedin',
        'LINKEDIN_CLIENT_ID',
        'LINKEDIN_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'instagram': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'instagram',
        'INSTAGRAM_CLIENT_ID',
        'INSTAGRAM_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://graph.instagram.com/refresh_access_token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        refreshStrategy: 'instagram_long_lived',
      }
    }
    case 'salesforce':
    case 'salesforce-sandbox': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'salesforce',
        'SALESFORCE_CLIENT_ID',
        'SALESFORCE_CLIENT_SECRET'
      )
      // A refresh token is only redeemable at the authorization server that
      // issued it: a sandbox token posted to login.salesforce.com fails with
      // `invalid_grant`. One Connected App's consumer key is valid at both
      // hosts, so only the endpoint differs.
      return {
        tokenEndpoint: `https://${SALESFORCE_LOGIN_HOSTS[provider]}/services/oauth2/token`,
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'shopify': {
      // Shopify access tokens don't expire and don't support refresh tokens
      // This configuration is provided for completeness but won't be used for token refresh
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'shopify',
        'SHOPIFY_CLIENT_ID',
        'SHOPIFY_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.shopify.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'zoom': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'zoom',
        'ZOOM_CLIENT_ID',
        'ZOOM_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://zoom.us/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'wordpress': {
      // WordPress.com does NOT support refresh tokens
      // Users will need to re-authorize when tokens expire (~2 weeks)
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'wordpress',
        'WORDPRESS_CLIENT_ID',
        'WORDPRESS_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'spotify': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'spotify',
        'SPOTIFY_CLIENT_ID',
        'SPOTIFY_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.spotify.com/api/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'monday': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'monday',
        'MONDAY_CLIENT_ID',
        'MONDAY_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: MONDAY_OAUTH_TOKEN_URL,
        clientId,
        clientSecret,
        useBasicAuth: false,
        useJsonBody: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'manageengine-sdp': {
      // ServiceDesk Plus Cloud authenticates through Zoho, so the grant is the
      // same one Zoho Desk uses and shares its client credentials: scopes are
      // chosen per authorization request, not per API-console client, so one
      // registered client serves both products.
      //
      // Rotation stays off for the same reason as zoho-desk below - Zoho's
      // refresh_token grant returns a new access token but no new refresh token.
      // accounts.zoho.com is correct because the authorize and code-exchange
      // legs in lib/auth/connectors/providers.ts are pinned to the US accounts
      // server, so every refresh token in the system is US-issued. Data
      // residency for API calls is honored separately, via the block's data
      // center selector.
      // Keyed on the `zoho-desk` capability, which is what
      // `resolveOAuthClientCapabilityId('manageengine-sdp')` aliases to — the
      // capability names the env pair, not the product.
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'zoho-desk',
        'ZOHO_CLIENT_ID',
        'ZOHO_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.zoho.com/oauth/v2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'zoho-desk': {
      // Zoho's refresh_token grant returns a new access token but no new refresh
      // token, so rotation stays off (the existing refresh token is preserved).
      // The refresh must target the accounts server of the data center that issued
      // the token - "if location=eu, you will need to make access token request to
      // https://accounts.zoho.eu" (zoho.com/accounts/protocol/oauth/multi-dc.html).
      // accounts.zoho.com is correct here because the authorize and code-exchange
      // legs in lib/auth/connectors/providers.ts are also pinned to the US accounts
      // server, so every refresh token in the system is US-issued. Making refresh
      // DC-aware requires making the grant DC-aware first (read the `accounts-server`
      // callback param) and threading the credential's persisted `__zoho_domain__`
      // marker into refreshOAuthToken, which today only receives the token string.
      // Data residency for API calls is already honored via that persisted Desk base.
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'zoho-desk',
        'ZOHO_CLIENT_ID',
        'ZOHO_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.zoho.com/oauth/v2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

/**
 * Build the authentication request headers and body for OAuth token refresh
 */
function buildAuthRequest(
  config: ProviderAuthConfig,
  refreshToken: string
): { headers: Record<string, string>; bodyParams: Record<string, string>; useJsonBody?: boolean } {
  const headers: Record<string, string> = {
    'Content-Type': config.useJsonBody ? 'application/json' : 'application/x-www-form-urlencoded',
    ...config.additionalHeaders,
  }

  const bodyParams: Record<string, string> = {
    grant_type: 'refresh_token',
  }

  if (config.refreshTokenInAuthHeader) {
    // Cal.com style: refresh token in Authorization header as Bearer token
    headers.Authorization = `Bearer ${refreshToken}`
  } else {
    bodyParams.refresh_token = refreshToken
  }

  if (config.useBasicAuth) {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
  } else {
    bodyParams[config.clientIdParamName || 'client_id'] = config.clientId
    if (config.clientSecret) {
      bodyParams.client_secret = config.clientSecret
    }
  }

  return { headers, bodyParams, useJsonBody: config.useJsonBody }
}

/**
 * Resolves the key {@link getProviderAuthConfig} is switched on for a stored
 * credential's provider id.
 *
 * Normally that is the base provider, because every service in a family
 * refreshes against the same endpoint with the same client. A provider id
 * listed in a service's `additionalProviderIds` is the exception: it names a
 * *different* authorization server for the same service, so it must reach
 * `getProviderAuthConfig` intact — collapsing it to the base would silently
 * refresh a sandbox token against the production endpoint.
 */
function getBaseProviderForService(providerId: string): string {
  if (providerId in OAUTH_PROVIDERS) {
    return providerId
  }

  for (const [baseProvider, config] of Object.entries(OAUTH_PROVIDERS)) {
    for (const service of Object.values(config.services)) {
      if (service.providerId === providerId) {
        return baseProvider
      }
      if (service.additionalProviderIds?.includes(providerId)) {
        return providerId
      }
    }
  }

  throw new Error(`Unknown OAuth provider: ${providerId}`)
}

export interface RefreshTokenSuccess {
  ok: true
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshTokenExpiresIn?: number
}

export interface RefreshTokenFailure {
  ok: false
  errorCode?: string
  message?: string
}

export type RefreshTokenResult = RefreshTokenSuccess | RefreshTokenFailure

function extractErrorCode(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error: unknown }).error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: unknown }).code
      if (typeof code === 'string' || typeof code === 'number') return String(code)
    }
  }
  return undefined
}

function safeOAuthErrorCode(value: unknown, secrets: string[]): string | undefined {
  const errorCode = extractErrorCode(value)
  if (!errorCode) return undefined
  const safeCode = redactExactSensitiveValues(errorCode, secrets).trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(safeCode) ? safeCode : undefined
}

/**
 * Hard deadline on the token-endpoint exchange. This function does not coalesce
 * on its own; its sole production caller (`performCoalescedRefresh` in the OAuth
 * utils) shares one in-flight refresh across concurrent callers for a credential.
 * Without this bound a hung endpoint would wedge every joiner on that key until
 * the undici socket defaults (~5 min) gave up.
 */
const TOKEN_REFRESH_TIMEOUT_MS = 15_000

function parseOAuthResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText)
  } catch {
    return responseText
  }
}

function oauthResponseRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const OAUTH_RESPONSE_OMITTED = '[token endpoint response omitted]'

async function refreshInstagramLongLivedToken(
  config: ProviderAuthConfig,
  longLivedToken: string,
  providerId: string
): Promise<RefreshTokenResult> {
  const url = new URL(config.tokenEndpoint)
  url.searchParams.set('grant_type', 'ig_refresh_token')
  url.searchParams.set('access_token', longLivedToken)

  const response = await providerFetch(url.toString(), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
  })

  const responseText = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Instagram token refresh response',
  })
  const responseData = parseOAuthResponse(responseText)

  if (!response.ok) {
    const exactSecrets = [longLivedToken, config.clientSecret ?? '']
    const errorCode = safeOAuthErrorCode(responseData, exactSecrets)
    logger.error('Instagram long-lived token refresh failed:', {
      status: response.status,
      error: OAUTH_RESPONSE_OMITTED,
      errorCode,
      providerId,
      tokenEndpoint: config.tokenEndpoint,
    })
    return {
      ok: false,
      errorCode,
      message: `Failed to refresh token: ${response.status} ${OAUTH_RESPONSE_OMITTED}`,
    }
  }

  const payload = parseInstagramLongLivedToken(responseData)
  if (!payload) {
    logger.warn('Invalid Instagram refresh response', { providerId })
    return { ok: false, message: 'Invalid Instagram token refresh response' }
  }

  logger.info('Instagram long-lived token refreshed successfully', {
    expiresIn: payload.expires_in,
    providerId,
  })

  // Instagram returns a new long-lived token; store it as both access and refresh.
  return {
    ok: true,
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
    refreshToken: payload.access_token,
  }
}

export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string,
  clientOverride?: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'clientSecret'>
): Promise<RefreshTokenResult> {
  const exactSecrets = [refreshToken]
  try {
    const provider = getBaseProviderForService(providerId)

    const config = getProviderAuthConfig(provider, clientOverride)
    if (config.clientSecret) exactSecrets.push(config.clientSecret)

    if (config.refreshStrategy === 'instagram_long_lived') {
      return await refreshInstagramLongLivedToken(config, refreshToken, providerId)
    }

    const { headers, bodyParams, useJsonBody } = buildAuthRequest(config, refreshToken)

    const response = await providerFetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: useJsonBody ? JSON.stringify(bodyParams) : new URLSearchParams(bodyParams).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
    })

    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OAuth token refresh response',
    })
    const responseData = parseOAuthResponse(responseText)

    if (!response.ok) {
      const errorCode = safeOAuthErrorCode(responseData, exactSecrets)

      logger.error('Token refresh failed:', {
        status: response.status,
        error: OAUTH_RESPONSE_OMITTED,
        errorCode,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode,
        message: `Failed to refresh token: ${response.status} ${OAUTH_RESPONSE_OMITTED}`,
      }
    }

    const data = oauthResponseRecord(responseData)
    if (!data) {
      logger.warn('Invalid OAuth token refresh response', { providerId })
      return { ok: false, message: 'Invalid OAuth token refresh response' }
    }

    if (
      data.ok === false ||
      (provider === 'github-repositories' && typeof data.error === 'string')
    ) {
      const errorCode = safeOAuthErrorCode(data, exactSecrets)
      logger.error('Token refresh failed:', {
        status: response.status,
        error: OAUTH_RESPONSE_OMITTED,
        errorCode,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode,
        message: `Failed to refresh token: ${OAUTH_RESPONSE_OMITTED}`,
      }
    }

    if (provider === 'github-repositories') {
      const tokens = parseGitHubRepositoriesTokenResponse(data)
      return {
        ok: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        refreshTokenExpiresIn: tokens.refresh_token_expires_in,
      }
    }

    const accessToken =
      typeof data.access_token === 'string' && data.access_token.length > 0
        ? data.access_token
        : undefined

    let newRefreshToken: string | undefined
    if (
      config.supportsRefreshTokenRotation &&
      typeof data.refresh_token === 'string' &&
      data.refresh_token.length > 0
    ) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }
    if (provider === 'monday' && !newRefreshToken) {
      logger.warn('Monday token refresh response omitted its rotating refresh token')
      return { ok: false, message: 'Invalid Monday token refresh response' }
    }
    if (provider === 'quickbooks' && !newRefreshToken) {
      logger.warn('QuickBooks token refresh response omitted its rotating refresh token')
      return { ok: false, message: 'Invalid QuickBooks token refresh response' }
    }

    const rawExpiresIn = data.expires_in ?? data.expiresIn
    const parsedExpiresIn =
      typeof rawExpiresIn === 'number' || typeof rawExpiresIn === 'string'
        ? Number(rawExpiresIn)
        : Number.NaN
    const responseExpiresIn =
      Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0 ? parsedExpiresIn : undefined
    const expiresIn =
      provider === 'monday' && accessToken
        ? Math.max(
            1,
            Math.ceil(
              (resolveMondayAccessTokenExpiresAt(accessToken, responseExpiresIn).getTime() -
                Date.now()) /
                1000
            )
          )
        : (responseExpiresIn ?? 3600)

    const rawRefreshTokenExpiresIn = data.x_refresh_token_expires_in
    const parsedRefreshTokenExpiresIn =
      typeof rawRefreshTokenExpiresIn === 'number' || typeof rawRefreshTokenExpiresIn === 'string'
        ? Number(rawRefreshTokenExpiresIn)
        : Number.NaN
    const refreshTokenExpiresIn =
      provider === 'quickbooks' &&
      Number.isSafeInteger(parsedRefreshTokenExpiresIn) &&
      parsedRefreshTokenExpiresIn > 0
        ? parsedRefreshTokenExpiresIn
        : undefined

    if (!accessToken) {
      // Log only the shape, never `data` itself - on a partial success it can
      // carry live tokens.
      logger.warn('No access token found in refresh response', {
        providerId,
        responseKeys: Object.keys(data ?? {}),
      })
      return { ok: false, message: 'No access token in refresh response' }
    }

    logger.info('Token refreshed successfully with expiration', {
      expiresIn,
      hasNewRefreshToken: !!newRefreshToken,
      provider,
    })

    return {
      ok: true,
      accessToken,
      expiresIn,
      refreshToken: newRefreshToken ?? refreshToken,
      ...(refreshTokenExpiresIn ? { refreshTokenExpiresIn } : {}),
    }
  } catch (error) {
    const normalized = toError(error)
    const message =
      normalized.name === 'PayloadSizeLimitError' || normalized.message.startsWith('OAuth client ')
        ? normalized.message
        : 'Token refresh failed'
    logger.error('Error refreshing token', { errorType: normalized.name })
    return { ok: false, message }
  }
}
