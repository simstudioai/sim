import { toArray, toRecord } from '@sim/utils/object'
import {
  normalizeHttpBaseUrl,
  refuseUnsafeTypedUrl,
  validateOktaDomain,
  validateSupabaseProjectId,
} from '@/lib/core/security/input-validation'
import { CLIENT_CREDENTIALS_AUTH_METHOD } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  fetchProvider,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import {
  allowedDomain,
  readJsonBody,
  tokenCheckValidator,
} from '@/lib/credentials/token-service-accounts/validators/http'
import { githubTokenExpiration, gitlabTokenExpiration } from '@/lib/credentials/vendor-token-expiry'
import { buildJupyterAuthHeaders, normalizeJupyterServerUrl } from '@/lib/internal/jupyter/protocol'
import { getDashboardHost } from '@/tools/amplitude/utils'
import { ashbyAuthHeaders } from '@/tools/ashby/utils'
import { BITBUCKET_API_BASE, bitbucketHeaders } from '@/tools/bitbucket/utils'
import { CBINSIGHTS_API_BASE } from '@/tools/cbinsights/utils'
import { checkrHeaders } from '@/tools/checkr/utils'
import { convexApiUrl, convexAuthHeaders } from '@/tools/convex/utils'
import { buildDynatraceUrl, dynatraceHeaders } from '@/tools/dynatrace/utils'
import { normalizeEmailBisonBaseUrl } from '@/tools/emailbison/utils'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'
import { gongAuthorization } from '@/tools/gong/utils'
import { GRANOLA_API_BASE, granolaHeaders } from '@/tools/granola/utils'
import { DEFAULT_HEX_HOST, hexApiBase, normalizeHexHost } from '@/tools/hex/utils'
import { buildJotformHeaders, buildJotformUrl, JOTFORM_REGION_HOSTS } from '@/tools/jotform/utils'
import { buildKalshiAuthHeaders, buildKalshiUrl } from '@/tools/kalshi/types'
import { LANGSMITH_REGIONS } from '@/tools/langsmith/utils'
import { LAUNCHDARKLY_INSTANCES } from '@/tools/launchdarkly/utils'
import {
  getLogfireBaseUrl,
  LOGFIRE_READ_TOKEN_INFO_PATH,
  logfireHeaders,
} from '@/tools/logfire/utils'
import type { MailgunRegion } from '@/tools/mailgun/types'
import { getMailgunApiBaseUrl } from '@/tools/mailgun/utils'
import { getNerdGraphEndpoint, NEW_RELIC_REGIONS, newRelicHeaders } from '@/tools/new_relic/utils'
import { oktaHeaders } from '@/tools/okta/utils'
import { planeApiUrl, planeHeaders } from '@/tools/plane/utils'
import {
  isPlanetScaleTokenPart,
  PLANETSCALE_API_ORIGIN,
  planetScaleHeaders,
} from '@/tools/planetscale/utils'
import { RAILWAY_GRAPHQL_URL, railwayHeaders } from '@/tools/railway/utils'
import { SENDGRID_REGIONS } from '@/tools/sendgrid/utils'
import { SENTRY_REGIONS } from '@/tools/sentry/utils'
import { SERVICENOW_BEARER_AUTH_STYLE, serviceNowAuthorization } from '@/tools/servicenow/utils'
import type { CredentialRegions } from '@/tools/shared/credential-regions'
import { buildSplunkHeaders, buildSplunkUrl } from '@/tools/splunk/utils'
import { SQUARE_ENVIRONMENTS } from '@/tools/square/types'
import { supabaseBaseUrl } from '@/tools/supabase/utils'
import { getThriveBaseUrl, getThriveHeaders, THRIVE_HOSTS } from '@/tools/thrive/utils'
import { isTwilioApiKeyPair, twilioAuthorization } from '@/tools/twilio/utils'
import { WHATSAPP_GRAPH_VERSION } from '@/tools/whatsapp/utils'

/**
 * Token checks for saved-credential providers whose key is verified by one
 * documented, read-only request. Most are declarations for
 * `tokenCheckValidator`; the few that need more (a host taken from the key, an
 * unknown-id lookup) sit alongside. Kept in one module so each new provider
 * costs a declaration, not a module, in every graph that verifies credentials.
 */

/** Regions for vendors with one US and one EU API host. */
const US_OR_EU: ReadonlySet<string> = new Set(['us', 'eu'])

/**
 * The connection fields of a credential whose domain is one of the vendor's fixed regions: only a
 * listed region is accepted, and the default one is the host the vendor always used.
 */
function vendorRegion(regions: CredentialRegions<string>) {
  return {
    domain: allowedDomain(regions),
    defaultDomain: regions.defaultRegion,
    domainIsVendorRegion: true,
  }
}

/** Affinity's whoami endpoint answers 200 for a valid key and 401 otherwise. */
export const validateAffinityServiceAccount = tokenCheckValidator({
  serviceLabel: 'Affinity',
  request: ({ apiToken }) => ({
    url: 'https://api.affinity.co/v2/auth/whoami',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * The AgentMail 403 codes its docs give for a valid key whose permissions or scope do not
 * cover the request: https://docs.agentmail.to/knowledge-base/api-403-error
 */
const AGENTMAIL_SCOPED_KEY_CODES: ReadonlySet<unknown> = new Set([
  'missing_permission',
  'forbidden',
])

/**
 * Listing one AgentMail inbox answers 200 for a valid key. A valid key that lacks the
 * inbox-read permission or is scoped to a pod or inbox gets a 403 coded `missing_permission`
 * or `forbidden`, and can still run the tools its scope covers. Every other refusal, from
 * the gateway's bare `{"message":"Forbidden"}` to a suspended account, rejects the key.
 */
export const validateAgentMailServiceAccount = tokenCheckValidator({
  serviceLabel: 'AgentMail',
  provesKey: (errorBody) => AGENTMAIL_SCOPED_KEY_CODES.has(toRecord(errorBody).code),
  request: ({ apiToken }) => ({
    url: 'https://api.agentmail.to/v0/inboxes?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** AgentPhone's usage endpoint answers 200 for a valid key and 401 otherwise. */
export const validateAgentPhoneServiceAccount = tokenCheckValidator({
  serviceLabel: 'AgentPhone',
  request: ({ apiToken }) => ({
    url: 'https://api.agentphone.to/v1/usage',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Ahrefs' limits-and-usage endpoint is free, answers 200 for a valid key and 401 otherwise. */
export const validateAhrefsServiceAccount = tokenCheckValidator({
  serviceLabel: 'Ahrefs',
  request: ({ apiToken }) => ({
    url: 'https://api.ahrefs.com/v3/subscription-info/limits-and-usage',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Algolia application IDs are alphanumeric; anything else could rewrite the tools' host. */
const ALGOLIA_APPLICATION_ID = /^[A-Za-z0-9]{1,32}$/

/**
 * Algolia's get-API-key endpoint lets any key read its own permissions, at the
 * `https://{applicationId}.algolia.net` host the tools use: 200 with the key's `acl`
 * for a valid key, a JSON 403 ("Invalid Application-ID or API key") otherwise.
 */
export const validateAlgoliaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Algolia',
  workspaceId: ({ providerWorkspaceId }) => {
    const applicationId = (providerWorkspaceId ?? '').trim()
    if (!ALGOLIA_APPLICATION_ID.test(applicationId)) {
      throw new Error('Algolia application IDs contain only letters and numbers')
    }
    return applicationId
  },
  request: ({ apiToken, providerWorkspaceId = '' }) => ({
    url: `https://${providerWorkspaceId}.algolia.net/1/keys/${encodeURIComponent(apiToken)}`,
    headers: {
      'x-algolia-application-id': providerWorkspaceId,
      'x-algolia-api-key': apiToken,
      Accept: 'application/json',
    },
  }),
  acceptsBody: (body) => {
    if (!Array.isArray(toRecord(body).acl)) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Algolia returned an unexpected key lookup',
      })
    }
    return true
  },
})

/** Printable ASCII without a colon: what an Amplitude API key can be as a Basic username. */
const AMPLITUDE_API_KEY = /^[\x21-\x39\x3b-\x7e]{1,256}$/
/** Printable ASCII, so the Basic credential encodes exactly as the tools' `btoa` does. */
const AMPLITUDE_SECRET_KEY = /^[\x21-\x7e]{1,256}$/

/**
 * Amplitude's Dashboard REST API lists a project's visible events for the API key and secret key
 * sent as HTTP Basic credentials, on the region's host the tools build with `getDashboardHost`.
 * Amplitude answers 403 when either key is invalid (401 is a malformed header), so the check
 * proves the pair and its region together; it is a read with no billing cost.
 * https://amplitude.com/docs/apis/analytics/dashboard-rest
 */
export const validateAmplitudeServiceAccount = tokenCheckValidator({
  serviceLabel: 'Amplitude',
  domain: allowedDomain(US_OR_EU),
  workspaceId: ({ providerWorkspaceId }) => {
    const apiKey = (providerWorkspaceId ?? '').trim()
    if (!AMPLITUDE_API_KEY.test(apiKey)) throw new Error('invalid API key')
    return apiKey
  },
  request: ({ apiToken, providerWorkspaceId = '', domain }) => {
    if (!AMPLITUDE_SECRET_KEY.test(apiToken)) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'invalid Amplitude secret key',
      })
    }
    return {
      url: `${getDashboardHost(domain)}/api/2/events/list`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${providerWorkspaceId}:${apiToken}`).toString('base64')}`,
        Accept: 'application/json',
      },
    }
  },
})

/** Apify's current-user endpoint answers 200 for a valid token and 401 otherwise. */
export const validateApifyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Apify',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.apify.com/v2/users/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * A one-row contact search costs no credits, works without a master key, and
 * answers 200 for a valid key and 401 otherwise (the health endpoint answers
 * 200 even for a bad key, so it cannot be used).
 */
export const validateApolloServiceAccount = tokenCheckValidator({
  serviceLabel: 'Apollo',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.apollo.io/api/v1/contacts/search',
    method: 'POST',
    headers: {
      'X-Api-Key': apiToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ page: 1, per_page: 1 }),
  }),
})

/**
 * Listing Ashby candidate sources answers 200 for a valid key. Ashby refuses an
 * unknown, wrong or deactivated key with 401 or 403; a valid key without the
 * module's read permission gets an error naming `missing_endpoint_permission`,
 * which still proves the key.
 */
export const validateAshbyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Ashby',
  request: ({ apiToken }) => ({
    url: 'https://api.ashbyhq.com/source.list',
    method: 'POST',
    headers: ashbyAuthHeaders(apiToken),
    body: '{}',
  }),
  provesKey: (errorBody) => {
    const { errorInfo, errors } = toRecord(errorBody)
    const messages = toArray(errors).map((entry) =>
      typeof entry === 'string' ? entry : toRecord(entry).message
    )
    return [toRecord(errorInfo).code, ...messages].includes('missing_endpoint_permission')
  },
})

/** Azure DevOps organization names: letters, digits, and hyphens, up to 50 characters. */
const AZURE_DEVOPS_ORGANIZATION = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/
/** The identity Azure DevOps reports when a request carries no usable credential. */
const AZURE_DEVOPS_ANONYMOUS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

/**
 * Azure DevOps' connection-data endpoint (what the official clients call on connect) answers any
 * PAT valid for the organization with its user, and 401 for an unknown PAT or one issued for
 * another organization once the sign-in redirect is suppressed. A public organization answers a
 * bad PAT with 200 and the anonymous identity, so the body must name a real user.
 */
export const validateAzureDevOpsServiceAccount = tokenCheckValidator({
  serviceLabel: 'Azure DevOps',
  workspaceId: ({ providerWorkspaceId }) => {
    const organization = (providerWorkspaceId ?? '').trim()
    if (!AZURE_DEVOPS_ORGANIZATION.test(organization)) throw new Error('invalid organization')
    return organization
  },
  request: ({ apiToken, providerWorkspaceId }) => ({
    url: `https://dev.azure.com/${providerWorkspaceId}/_apis/connectionData`,
    headers: {
      Authorization: `Basic ${Buffer.from(`:${apiToken}`).toString('base64')}`,
      'X-TFS-FedAuthRedirect': 'Suppress',
      Accept: 'application/json',
    },
  }),
  acceptsBody: (body) => {
    const user = toRecord(toRecord(body).authenticatedUser)
    return (
      typeof user.id === 'string' &&
      user.id.length > 0 &&
      user.id !== AZURE_DEVOPS_ANONYMOUS_ID &&
      !(typeof user.descriptor === 'string' && user.descriptor.startsWith('System:PublicAccess'))
    )
  },
})

/**
 * Brex's current-user endpoint answers 200 for a valid user token. An unknown
 * token gets the same JSON 403 as a token missing the user scope, told apart
 * only by its message.
 */
export const validateBrexServiceAccount = tokenCheckValidator({
  serviceLabel: 'Brex',
  forbiddenMeansScoped: true,
  rejectsKey: (errorBody) => /invalid or revoked token/i.test(String(toRecord(errorBody).message)),
  request: ({ apiToken }) => ({
    url: 'https://api.brex.com/v2/users/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Bright Data's active-zones listing answers 200 for a valid token and 401 otherwise. */
export const validateBrightDataServiceAccount = tokenCheckValidator({
  serviceLabel: 'Bright Data',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.brightdata.com/zone/get_active_zones',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Browser Use's account billing endpoint answers 200 for a valid key and 401 otherwise. */
export const validateBrowserUseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Browser Use',
  request: ({ apiToken }) => ({
    url: 'https://api.browser-use.com/api/v2/billing/account',
    headers: { 'X-Browser-Use-API-Key': apiToken, Accept: 'application/json' },
  }),
})

/**
 * Buffer's GraphQL API can report a rejected key as an `UNAUTHORIZED` error in
 * a 200 body, so the key is proven only when the account query returns an id.
 */
export const validateBufferServiceAccount = tokenCheckValidator({
  serviceLabel: 'Buffer',
  request: ({ apiToken }) => ({
    url: 'https://api.buffer.com',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: 'query { account { id } }' }),
  }),
  acceptsBody: (body) => {
    const account = toRecord(toRecord(toRecord(body).data).account)
    return typeof account.id === 'string' && account.id.length > 0
  },
})

/** A CB Insights client ID: printable ASCII, sent only in the authorize request body. */
const CBINSIGHTS_CLIENT_ID = /^[\x21-\x7e]{1,256}$/

/**
 * Exchanging the client ID and secret for an access token at `POST /v2/authorize`, the call the
 * tools make before their first request, proves the pair; a success without a token is not
 * proof. The token is discarded: the tools mint their own on each run.
 * https://api-docs.cbinsights.com/portal/docs/CBI-API/Authentication
 */
export const validateCbInsightsServiceAccount = tokenCheckValidator({
  serviceLabel: 'CB Insights',
  workspaceId: ({ providerWorkspaceId }) => {
    const clientId = (providerWorkspaceId ?? '').trim()
    if (!CBINSIGHTS_CLIENT_ID.test(clientId)) throw new Error('invalid client ID')
    return clientId
  },
  errorBodyEchoesToken: true,
  request: ({ apiToken, providerWorkspaceId = '' }) => ({
    url: `${CBINSIGHTS_API_BASE}/v2/authorize`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ clientId: providerWorkspaceId, clientSecret: apiToken }),
  }),
  acceptsBody: (body) => {
    const token = toRecord(body).token
    if (typeof token !== 'string' || !token) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'CB Insights authorization returned no token',
      })
    }
    return true
  },
})

/**
 * Calendly's current-user endpoint answers 200 for a valid token and 401
 * otherwise; a valid token without the `users:read` scope gets a JSON 403.
 */
export const validateCalendlyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Calendly',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.calendly.com/users/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Checkr's account endpoint answers 200 for a valid production secret key and 401 otherwise. */
export const validateCheckrServiceAccount = tokenCheckValidator({
  serviceLabel: 'Checkr',
  request: ({ apiToken }) => ({
    url: 'https://api.checkr.com/v1/account',
    headers: checkrHeaders(apiToken),
  }),
})

/** Listing Circleback tags answers 200 for a valid key and 401 otherwise. */
export const validateCirclebackServiceAccount = tokenCheckValidator({
  serviceLabel: 'Circleback',
  request: ({ apiToken }) => ({
    url: 'https://circleback.ai/api/tag',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Clerk's Backend API lists users only for a valid secret key and answers 401 otherwise. */
export const validateClerkServiceAccount = tokenCheckValidator({
  serviceLabel: 'Clerk',
  request: ({ apiToken }) => ({
    url: 'https://api.clerk.com/v1/users?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Listing accounts succeeds for any valid user- or account-owned API token
 * (`/user/tokens/verify` rejects account-owned ones) and fails for a bad token.
 */
export const validateCloudflareServiceAccount = tokenCheckValidator({
  serviceLabel: 'Cloudflare',
  request: ({ apiToken }) => ({
    url: 'https://api.cloudflare.com/client/v4/accounts?per_page=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Listing table schemas is a read the List Tables tool already makes: a bad Convex deploy
 * key gets 401, a key minted for another deployment gets 403 `BadDeployKey`, and any other
 * JSON 403 is a valid key whose permissions exclude data reads. The deployment URL is
 * normalized and SSRF-checked by the tools' own `convexApiUrl`.
 */
export const validateConvexServiceAccount = tokenCheckValidator({
  serviceLabel: 'Convex',
  domain: ({ domain }) => {
    const deploymentUrl = convexApiUrl(domain ?? '', '')
    const parsed = new URL(deploymentUrl)
    if (parsed.username || parsed.password) throw new Error('credentials in URL')
    return deploymentUrl
  },
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain = '' }) => ({
    url: convexApiUrl(domain, '/api/json_schemas?format=json'),
    headers: { ...convexAuthHeaders(apiToken), Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
  rejectsKey: (errorBody) => toRecord(errorBody).code === 'BadDeployKey',
})

/** Crunchbase's autocomplete endpoint answers 200 for a valid user key and 401 otherwise. */
export const validateCrunchbaseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Crunchbase',
  request: ({ apiToken }) => ({
    url: 'https://api.crunchbase.com/v4/data/autocompletes?query=a&limit=1',
    headers: { 'X-cb-user-key': apiToken, Accept: 'application/json' },
  }),
})

/** Cursor's API key info endpoint answers 200 for a valid key and 401 otherwise. */
export const validateCursorServiceAccount = tokenCheckValidator({
  serviceLabel: 'Cursor',
  request: ({ apiToken }) => ({
    url: 'https://api.cursor.com/v0/me',
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiToken}:`).toString('base64')}`,
      Accept: 'application/json',
    },
  }),
})

/** Daytona describes the calling API key only when it is valid, with no extra permission. */
export const validateDaytonaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Daytona',
  request: ({ apiToken }) => ({
    url: 'https://app.daytona.io/api/api-keys/current',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Listing one session of the organization is the tools' own read on their host and auth: 200
 * proves the key and its access to that organization (it needs `ViewOrgSessions`). Devin
 * answers an invalid key with 401, and both a key outside the organization and one without the
 * permission with the same problem+json 403; nothing documented tells those two apart, so a
 * 403 rejects. The id must survive URL encoding unchanged, so it can never steer the tools'
 * unencoded path.
 */
export const validateDevinServiceAccount = tokenCheckValidator({
  serviceLabel: 'Devin',
  workspaceId: ({ providerWorkspaceId }) => {
    const orgId = (providerWorkspaceId ?? '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(orgId)) throw new Error('invalid organization id')
    return orgId
  },
  request: ({ apiToken, providerWorkspaceId }) => ({
    url: `https://api.devin.ai/v3/organizations/${providerWorkspaceId}/sessions?first=1`,
    headers: { Authorization: `Bearer ${apiToken.trim()}`, Accept: 'application/json' },
  }),
})

/** Discord returns the bot's own user for a valid bot token and 401 otherwise. */
export const validateDiscordServiceAccount = tokenCheckValidator({
  serviceLabel: 'Discord',
  request: ({ apiToken }) => ({
    url: 'https://discord.com/api/v10/users/@me',
    headers: { Authorization: `Bot ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Dub's domain list answers 200 for a valid key, 401 for an unknown one, and a
 * JSON 403 for a restricted key without the domains scope.
 */
export const validateDubServiceAccount = tokenCheckValidator({
  serviceLabel: 'Dub',
  request: ({ apiToken }) => ({
    url: 'https://api.dub.co/domains?pageSize=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
})

/**
 * Dynatrace's token lookup accepts an access token with any scope and returns its own
 * metadata, including whether it is enabled; an unknown token gets 401.
 */
export const validateDynatraceServiceAccount = tokenCheckValidator({
  serviceLabel: 'Dynatrace',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain).replace(/\/api\/v[12]$/i, ''),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain = '' }) => ({
    url: buildDynatraceUrl(domain, '/apiTokens/lookup'),
    method: 'POST',
    headers: dynatraceHeaders(apiToken),
    body: JSON.stringify({ token: apiToken }),
  }),
  acceptsBody: (body) => {
    const token = toRecord(body)
    if (typeof token.enabled !== 'boolean') {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Dynatrace returned an unexpected token lookup',
      })
    }
    return token.enabled
  },
})

/**
 * ElevenLabs returns the key owner's account for a valid key and 400/401 for a bad one. A key
 * without the user permission gets a 401 naming `missing_permissions`, or a 403, both of which
 * still prove it authenticated.
 */
export const validateElevenLabsServiceAccount = tokenCheckValidator({
  serviceLabel: 'ElevenLabs',
  request: ({ apiToken }) => ({
    url: 'https://api.elevenlabs.io/v1/user',
    headers: { 'xi-api-key': apiToken, Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
  provesKey: (errorBody) => toRecord(toRecord(errorBody).detail).status === 'missing_permissions',
})

/**
 * Email Bison's `GET /api/users` returns the token's user on the instance it was typed with
 * (dedi.emailbison.com or a white-labeled host), stored as the HTTPS origin the tools use; an
 * unknown token answers 401. A 200 without Email Bison's user envelope is some other site.
 */
export const validateEmailBisonServiceAccount = tokenCheckValidator({
  serviceLabel: 'Email Bison',
  domain: ({ domain }) => normalizeEmailBisonBaseUrl(refuseUnsafeTypedUrl(domain)),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => ({
    url: `${domain}/api/users`,
    headers: { Authorization: `Bearer ${apiToken.trim()}`, Accept: 'application/json' },
  }),
  acceptsBody: (body) => {
    const user = toRecord(toRecord(body).data)
    return user.id !== undefined && user.id !== null
  },
})

/** Enrich's credit-balance endpoint costs no credits and succeeds only for a valid key. */
export const validateEnrichServiceAccount = tokenCheckValidator({
  serviceLabel: 'Enrich',
  request: ({ apiToken }) => ({
    url: 'https://api.enrich.so/v1/api/auth',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Extend's file list, on the API version the parser uses, answers 200 for a valid key and 401 otherwise. */
export const validateExtendServiceAccount = tokenCheckValidator({
  serviceLabel: 'Extend',
  request: ({ apiToken }) => ({
    url: 'https://api.extend.ai/files?maxPageSize=1',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'x-extend-api-version': '2025-04-21',
      Accept: 'application/json',
    },
  }),
})

/** Fathom's list-teams endpoint answers 200 for a valid API key and 401 otherwise. */
export const validateFathomServiceAccount = tokenCheckValidator({
  serviceLabel: 'Fathom',
  request: ({ apiToken }) => ({
    url: 'https://api.fathom.ai/external/v1/teams',
    headers: { 'X-Api-Key': apiToken, Accept: 'application/json' },
  }),
})

/**
 * Fireflies' GraphQL `user` query returns the key owner for a valid key. A
 * rejected key comes back as HTTP 500 with an `auth_failed` error.
 */
export const validateFirefliesServiceAccount = tokenCheckValidator({
  serviceLabel: 'Fireflies',
  request: ({ apiToken }) => ({
    url: 'https://api.fireflies.ai/graphql',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: '{ user { user_id } }' }),
  }),
  rejectsKey: (errorBody) =>
    toArray(toRecord(errorBody).errors).some((error) => toRecord(error).code === 'auth_failed'),
  acceptsBody: (body) => {
    if (typeof body !== 'object' || body === null || 'errors' in body) return false
    const data = (body as { data?: { user?: { user_id?: unknown } | null } | null }).data
    return typeof data?.user?.user_id === 'string'
  },
})

/**
 * Flint has no identity endpoint, so the key is checked against the documented get-task route
 * with an ID no organization owns, shaped like the documented `bg-550e8400-a1b2c3d4` so a format
 * check can't answer first: an accepted key gets 404, a rejected one gets 401.
 */
const FLINT_VERIFY_URL = 'https://app.tryflint.com/api/v1/agent/tasks/bg-00000000-00000000'

export async function validateFlintServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const response = await fetchProvider(
    FLINT_VERIFY_URL,
    {
      headers: { Authorization: `Bearer ${fields.apiToken.trim()}`, Accept: 'application/json' },
      redirect: 'error',
    },
    'get_task'
  )
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new TokenServiceAccountValidationError('provider_unavailable', response.status, {
      step: 'get_task',
      reason: 'expected 404 for an unknown task',
    })
  }
  if (response.status !== 404) await throwForProviderResponse(response, 'get_task')
  // Only Flint's own JSON answer proves the key; an HTML 404 from a proxy proves nothing.
  const body = toRecord(await readJsonBody(response, 'Flint').catch(() => null))
  if (body.error !== 'Task not found') {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'get_task',
      reason: 'unexpected 404 body',
    })
  }

  return { displayName: 'Flint', principal: null, auditMetadata: {} }
}

/** Gamma lists themes for a valid API key and answers 401 for a missing or bad one. */
export const validateGammaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Gamma',
  request: ({ apiToken }) => ({
    url: 'https://public-api.gamma.app/v1.0/themes?limit=1',
    headers: { 'X-API-KEY': apiToken, Accept: 'application/json' },
  }),
})

/**
 * GitHub's authenticated-user endpoint is available to fine-grained and classic personal
 * access tokens alike (fine-grained tokens need no permission for it): 200 with the token
 * owner for a valid token, 401 for a bad one, and 403 for a token that cannot act as a user
 * (a GitHub App installation token). Sent with the same host, scheme, and headers as the
 * GitHub tools; Enterprise Server hosts are deliberately not offered.
 * https://docs.github.com/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens
 */
export const validateGitHubServiceAccount = tokenCheckValidator({
  serviceLabel: 'GitHub',
  request: ({ apiToken }) => ({
    url: 'https://api.github.com/user',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Sim',
    },
  }),
  acceptsBody: (body) => {
    const { login } = toRecord(body)
    if (typeof login !== 'string' || !login.trim()) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'GitHub returned an unexpected user lookup',
      })
    }
    return { displayName: `${login.trim()} (GitHub)` }
  },
  expiresAt: ({ headers }) =>
    githubTokenExpiration(headers.get('github-authentication-token-expiration')),
})

/**
 * A repository as `workspace/repository`: a workspace slug, then a repository slug that
 * cannot be `.` or `..`, so neither half can climb out of the request path.
 */
const BITBUCKET_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,61}$/

/**
 * Bitbucket access tokens belong to a workspace, project, or repository rather than a user,
 * so the user endpoints refuse them, and a repository token reaches only its repository.
 * Reading one repository the token can see is the request Atlassian documents for all
 * three kinds (`GET /2.0/repositories/{workspace}/{repository}` with the `repository`
 * scope): 200 with the repository, 401 for a bad token, 403 without the scope, and 404 for
 * a repository that does not exist or that the token cannot reach. An Atlassian API token
 * created for Bitbucket passes the same read, since Bitbucket takes it as a Bearer token
 * without the account email.
 * https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/
 * https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/
 */
export const validateBitbucketServiceAccount = tokenCheckValidator({
  serviceLabel: 'Bitbucket',
  workspaceId: ({ providerWorkspaceId }) => {
    const repository = (providerWorkspaceId ?? '').trim()
    if (!BITBUCKET_REPOSITORY.test(repository)) throw new Error('invalid repository')
    return repository
  },
  request: ({ apiToken, providerWorkspaceId = '' }) => ({
    url: `${BITBUCKET_API_BASE}/repositories/${providerWorkspaceId}`,
    headers: bitbucketHeaders(apiToken),
  }),
  acceptsBody: (body) => {
    if (typeof toRecord(body).full_name !== 'string') {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Bitbucket returned an unexpected repository',
      })
    }
    return true
  },
})

/** Scopes that let the GitLab tools call the REST API. */
const GITLAB_API_SCOPES = new Set(['api', 'read_api'])

/**
 * GitLab's token self-lookup answers for a personal, project, or group access token at the
 * instance it was typed with (gitlab.com or self-managed); the token must be active and carry an
 * API scope. A reply that isn't a token lookup is the instance misbehaving, not a bad token.
 */
export const validateGitLabServiceAccount = tokenCheckValidator({
  serviceLabel: 'GitLab',
  domain: ({ domain }) => normalizeGitLabHost(domain),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => ({
    url: `https://${domain}/api/v4/personal_access_tokens/self`,
    headers: { 'PRIVATE-TOKEN': apiToken, Accept: 'application/json' },
  }),
  acceptsBody: (body) => {
    const token = toRecord(body)
    if (typeof token.active !== 'boolean' || !Array.isArray(token.scopes)) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'GitLab returned an unexpected token lookup',
      })
    }
    const usable =
      token.active &&
      token.revoked !== true &&
      token.scopes.some((scope) => GITLAB_API_SCOPES.has(String(scope)))
    const name = typeof token.name === 'string' ? token.name.trim() : ''
    return usable && name ? { displayName: name } : usable
  },
  expiresAt: ({ body }) => gitlabTokenExpiration(toRecord(body).expires_at),
})

/**
 * Listing workspaces is a cheap documented read on the fixed host the tools call, with the same
 * Basic header the tools send (`gongAuthorization`). Gong documents a 403 ("Access denied") for
 * this read without telling a bad key from a missing permission, so any refusal rejects. The
 * access key is the Basic username, so one with a colon is refused unsent, as is a pair the
 * header cannot encode.
 */
export const validateGongServiceAccount = tokenCheckValidator({
  serviceLabel: 'Gong',
  workspaceId: ({ providerWorkspaceId }) => {
    const accessKey = (providerWorkspaceId ?? '').trim()
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(accessKey)) throw new Error('invalid access key')
    return accessKey
  },
  request: ({ apiToken, providerWorkspaceId = '' }) => {
    let authorization: string
    try {
      authorization = gongAuthorization(providerWorkspaceId, apiToken)
    } catch {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'invalid Gong access key secret',
      })
    }
    return {
      url: 'https://api.gong.io/v2/workspaces',
      headers: { Authorization: authorization, Accept: 'application/json' },
    }
  },
})

/**
 * Grafana's `GET /api/user` needs a signed-in, non-anonymous identity but no role, so it
 * answers 200 for any valid service account token and 401 for a bad one, even where
 * anonymous access lets most reads answer 200 to any token.
 */
export const validateGrafanaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Grafana',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => ({
    url: `${domain}/api/user`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  acceptsBody: (body) => {
    const login = toRecord(body).login
    if (typeof login !== 'string' || !login.trim()) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Grafana returned an unexpected user lookup',
      })
    }
    return true
  },
})

/**
 * Grain's list-teams endpoint (a read-only POST, as the tools call it) answers 200 for a valid
 * access token and 401 `invalid_token` otherwise.
 */
export const validateGrainServiceAccount = tokenCheckValidator({
  serviceLabel: 'Grain',
  request: ({ apiToken }) => ({
    url: 'https://api.grain.com/_/public-api/v2/teams',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Public-Api-Version': '2025-10-31',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  }),
})

/**
 * Listing one Granola note answers 200 for a valid personal or workspace API key and 401 otherwise.
 * An Enterprise admin can turn off note scopes for members, so a JSON 403 still proves the key.
 */
export const validateGranolaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Granola',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: `${GRANOLA_API_BASE}/notes?page_size=1`,
    headers: { ...granolaHeaders(apiToken), Accept: 'application/json' },
  }),
})

/**
 * Hex's list-projects endpoint (the one the Hex tools call) answers 200 for a valid token and 401
 * otherwise, on the hex.tech host of the token's workspace.
 */
export const validateHexServiceAccount = tokenCheckValidator({
  serviceLabel: 'Hex',
  domain: ({ domain }) => normalizeHexHost(domain),
  defaultDomain: DEFAULT_HEX_HOST,
  request: ({ apiToken, domain }) => ({
    url: `${hexApiBase(domain)}/projects?limit=1`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Hugging Face's whoami-v2 endpoint answers 200 for any valid access token and 401 otherwise. */
export const validateHuggingfaceServiceAccount = tokenCheckValidator({
  serviceLabel: 'Hugging Face',
  request: ({ apiToken }) => ({
    url: 'https://huggingface.co/api/whoami-v2',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** incident.io's identity endpoint describes the calling API key, so it answers 200 for any valid key and 401 otherwise. */
export const validateIncidentioServiceAccount = tokenCheckValidator({
  serviceLabel: 'incident.io',
  request: ({ apiToken }) => ({
    url: 'https://api.incident.io/v1/identity',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Infisical's `GET /api/v1/identities/details`, called with a machine identity's own access token
 * on its instance (US, EU, or self-hosted), needs no project permission and answers the identity's
 * organization; a malformed, expired, or wrong-instance token gets a JSON 403 TokenError.
 */
export const validateInfisicalServiceAccount = tokenCheckValidator({
  serviceLabel: 'Infisical',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => ({
    url: `${domain}/api/v1/identities/details`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  acceptsBody: (body) => {
    const organization = toRecord(toRecord(toRecord(body).identityDetails).organization)
    if (typeof organization.id !== 'string' || !organization.id) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Infisical returned unexpected identity details',
      })
    }
    return true
  },
})

/**
 * Instantly's campaign list (the one the Instantly tools call) answers 200 for a valid key and
 * 401 for a bad one; a valid key without the campaigns scope gets 403.
 */
export const validateInstantlyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Instantly',
  request: ({ apiToken }) => ({
    url: 'https://api.instantly.ai/api/v2/campaigns?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
})

/** Intercom's identify-admin endpoint answers 200 with the token's admin and 401 to an unknown token. */
export const validateIntercomServiceAccount = tokenCheckValidator({
  serviceLabel: 'Intercom',
  request: ({ apiToken }) => ({
    url: 'https://api.intercom.io/me',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      'Intercom-Version': '2.14',
    },
  }),
})

/**
 * Jotform's account endpoint on the region's host (via the tools' URL builder) answers 200 for a
 * valid key and 401 otherwise; a key only works on the host that issued it, so a wrong region is
 * refused too. Jotform reports some failures inside a 200, so `responseCode` must also be 200.
 */
export const validateJotformServiceAccount = tokenCheckValidator({
  serviceLabel: 'Jotform',
  domain: allowedDomain(new Set(Object.keys(JOTFORM_REGION_HOSTS))),
  request: ({ apiToken, domain }) => ({
    url: buildJotformUrl({ apiKey: apiToken, region: domain }, 'user').toString(),
    headers: { ...buildJotformHeaders(apiToken), Accept: 'application/json' },
  }),
  acceptsBody: (body) => Number(toRecord(body).responseCode) === 200,
})

/**
 * Jupyter's `GET /api/status` is authenticated and answers a bad token with 403, never a
 * login redirect. The server URL is normalized as the tools normalize it and reached
 * under the same `selfHostedService` egress profile.
 */
export const validateJupyterServiceAccount = tokenCheckValidator({
  serviceLabel: 'Jupyter',
  domain: ({ domain }) => normalizeJupyterServerUrl(refuseUnsafeTypedUrl(domain)),
  egress: 'selfHostedService',
  request: ({ apiToken, domain }) => ({
    url: `${domain}/api/status`,
    headers: { ...buildJupyterAuthHeaders(apiToken), Accept: 'application/json' },
  }),
  acceptsBody: (body) => {
    if (typeof toRecord(body).started !== 'string') {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Jupyter returned an unexpected status',
      })
    }
    return true
  },
})

/**
 * Listing collections (`GET /collections`) is a read every Qdrant key may run (a collection-scoped
 * key sees a filtered list), sent with the `api-key` header the tools send. The instance URL is
 * one the user chose, so the check runs through the guarded egress, and an answer without a
 * collection list (a proxy or login page) is not taken as proof. A self-hosted instance with no
 * API key configured accepts any key; the credential still binds the instance URL.
 * https://api.qdrant.tech/api-reference/collections/get-collections
 */
export const validateQdrantServiceAccount = tokenCheckValidator({
  serviceLabel: 'Qdrant',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain = '' }) => ({
    url: `${domain}/collections`,
    headers: { 'api-key': apiToken, Accept: 'application/json' },
  }),
  acceptsBody: (body) => {
    if (!Array.isArray(toRecord(toRecord(body).result).collections)) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Qdrant returned no collection list',
      })
    }
    return true
  },
})

/** The token types a Railway credential names, each read by the query its scope allows. */
const RAILWAY_TOKEN_TYPES = new Set(['account', 'workspace', 'project'])
/** A Railway workspace ID, sent only as a GraphQL variable. */
const RAILWAY_WORKSPACE_ID = /^[A-Za-z0-9-]{1,64}$/

/**
 * Each Railway token type has its own documented read, because `me` answers only an account
 * token: an account token reads `me`, a workspace token reads its workspace by ID (the only
 * workspace it can see), and a project token reads `projectToken` with the Project-Access-Token
 * header the tools send for it. Railway reports a refused token as a GraphQL error, so only a
 * body carrying the queried object proves it.
 * https://docs.railway.com/integrations/api
 */
export const validateRailwayServiceAccount = tokenCheckValidator({
  serviceLabel: 'Railway',
  domain: allowedDomain(RAILWAY_TOKEN_TYPES),
  request: ({ apiToken, domain, providerWorkspaceId = '' }) => {
    if (domain === 'workspace' && !RAILWAY_WORKSPACE_ID.test(providerWorkspaceId)) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'a workspace token needs its workspace ID',
      })
    }
    const query =
      domain === 'project'
        ? { query: 'query { projectToken { projectId environmentId } }' }
        : domain === 'workspace'
          ? {
              query:
                'query Workspace($workspaceId: String!) { workspace(workspaceId: $workspaceId) { id } }',
              variables: { workspaceId: providerWorkspaceId },
            }
          : { query: 'query { me { id } }' }
    return {
      url: RAILWAY_GRAPHQL_URL,
      method: 'POST',
      headers: railwayHeaders(apiToken, domain === 'project' ? 'project' : 'account'),
      body: JSON.stringify(query),
    }
  },
  acceptsBody: (body) => {
    const record = toRecord(body)
    if (toArray(record.errors).length > 0) return false
    const [queried] = Object.values(toRecord(record.data))
    return Object.keys(toRecord(queried)).length > 0
  },
})

/**
 * LangSmith's workspace list answers 200 for a valid API key and 401/403 otherwise, in the region
 * the key's organization lives in; a key from another region is not recognized.
 */
export const validateLangsmithServiceAccount = tokenCheckValidator({
  serviceLabel: 'LangSmith',
  ...vendorRegion(LANGSMITH_REGIONS),
  request: ({ apiToken, domain }) => ({
    url: `${LANGSMITH_REGIONS.apiBase(domain)}/workspaces`,
    headers: { 'X-Api-Key': apiToken, Accept: 'application/json' },
  }),
})

/**
 * LaunchDarkly's caller-identity endpoint describes the calling token, so it answers 200 for any
 * valid token and 401 otherwise, on the instance (commercial, EU, or federal) the token was
 * created in.
 */
export const validateLaunchdarklyServiceAccount = tokenCheckValidator({
  serviceLabel: 'LaunchDarkly',
  ...vendorRegion(LAUNCHDARKLY_INSTANCES),
  request: ({ apiToken, domain }) => ({
    url: `${LAUNCHDARKLY_INSTANCES.apiBase(domain)}/caller-identity`,
    headers: { Authorization: apiToken, Accept: 'application/json' },
  }),
})

/**
 * Lemlist's team endpoint answers 200 for a valid API key and 401 otherwise; the key is the
 * Basic-auth password with an empty username, as the tools send it.
 */
export const validateLemlistServiceAccount = tokenCheckValidator({
  serviceLabel: 'Lemlist',
  request: ({ apiToken }) => ({
    url: 'https://api.lemlist.com/api/team',
    headers: {
      Authorization: `Basic ${Buffer.from(`:${apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
  }),
})

/** Linq's phone-number list (the one the Linq tools call) answers 200 for a valid key and 401 otherwise. */
export const validateLinqServiceAccount = tokenCheckValidator({
  serviceLabel: 'Linq',
  request: ({ apiToken }) => ({
    url: 'https://api.linqapp.com/api/partner/v3/phone_numbers',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

const LOGFIRE_CLOUD_REGIONS = new Set(['auto', 'us', 'eu'])

/**
 * Logfire's read-token-info endpoint answers any read token with its organization and
 * project, and 401 for an unknown token (including one from the other region). The
 * region or host field resolves through the tools' own `getLogfireBaseUrl` (`us`/`eu`
 * picks that Cloud region, `auto` reads it from the token's prefix, anything else is a
 * self-hosted base URL), and the stored base URL fills the tools' `host`, which wins.
 */
export const validateLogfireServiceAccount = tokenCheckValidator({
  serviceLabel: 'Logfire',
  domain: ({ apiToken, domain }) => {
    const typed = (domain ?? '').trim()
    if (!typed) throw new Error('missing region or host')
    const region = typed.toLowerCase()
    if (LOGFIRE_CLOUD_REGIONS.has(region)) {
      return getLogfireBaseUrl(apiToken, region as 'auto' | 'us' | 'eu')
    }
    // A self-hosted base URL names a domain, a port, or a scheme; a bare word is a mistyped region.
    if (!/[.:]/.test(typed)) throw new Error('unknown region')
    return getLogfireBaseUrl(apiToken, 'auto', refuseUnsafeTypedUrl(typed))
  },
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => ({
    url: `${domain}${LOGFIRE_READ_TOKEN_INFO_PATH}`,
    headers: logfireHeaders(apiToken),
  }),
  acceptsBody: (body) => {
    const project = toRecord(body).project_name
    if (typeof project !== 'string' || !project.trim()) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Logfire returned an unexpected token lookup',
      })
    }
    return true
  },
})

/** Loops' API-key test endpoint answers 200 for a valid key and 401 otherwise. */
export const validateLoopsServiceAccount = tokenCheckValidator({
  serviceLabel: 'Loops',
  request: ({ apiToken }) => ({
    url: 'https://app.loops.so/api/v1/api-key',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Luma's get-self endpoint returns the key's user, so it answers 200 for a valid key and 401 otherwise. */
export const validateLumaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Luma',
  request: ({ apiToken }) => ({
    url: 'https://public-api.luma.com/v1/users/get-self',
    headers: { 'x-luma-api-key': apiToken, Accept: 'application/json' },
  }),
})

/** The data center suffix (`-us21`) that names the key's API host. */
const DATA_CENTER_SUFFIX = /-([a-z]+\d+)$/

/**
 * Mailchimp's ping endpoint answers 200 for a valid key and 401 otherwise. The
 * host comes from the key's data center suffix, which must match before any
 * request so a crafted key can never point the check at another host.
 */
export const validateMailchimpServiceAccount = tokenCheckValidator({
  serviceLabel: 'Mailchimp',
  request: ({ apiToken }) => {
    const dataCenter = DATA_CENTER_SUFFIX.exec(apiToken)?.[1]
    if (!dataCenter) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'Mailchimp API key has no data center suffix',
      })
    }
    return {
      url: `https://${dataCenter}.api.mailchimp.com/3.0/ping`,
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    }
  },
})

/** A Kalshi API key ID travels as a header value, so only printable ASCII without spaces. */
const KALSHI_KEY_ID = /^[\x21-\x7e]{1,128}$/
const KALSHI_BALANCE_PATH = '/portfolio/balance'

/**
 * Reading the account balance is a free, read-only request signed the way the tools sign every
 * authenticated call (`buildKalshiAuthHeaders`), so it succeeds only when the signature verifies
 * against the key ID's registered public key; any refusal rejects the key. A private key that cannot sign
 * (not PEM, or neither RSA nor Ed25519) is refused before any request.
 * https://docs.kalshi.com/getting_started/api_keys
 */
export const validateKalshiServiceAccount = tokenCheckValidator({
  serviceLabel: 'Kalshi',
  workspaceId: ({ providerWorkspaceId }) => {
    const keyId = (providerWorkspaceId ?? '').trim()
    if (!KALSHI_KEY_ID.test(keyId)) throw new Error('invalid API key ID')
    return keyId
  },
  request: ({ apiToken, providerWorkspaceId = '' }) => {
    let headers: Record<string, string>
    try {
      headers = buildKalshiAuthHeaders(
        providerWorkspaceId,
        apiToken,
        'GET',
        new URL(buildKalshiUrl(KALSHI_BALANCE_PATH)).pathname
      )
    } catch {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'Kalshi private key cannot sign',
      })
    }
    return {
      url: buildKalshiUrl(KALSHI_BALANCE_PATH),
      headers: { ...headers, Accept: 'application/json' },
    }
  },
})

/**
 * Splunk's `authentication/current-context` returns the user a request authenticates as and
 * needs no capability, so any valid authentication token, or username and password sent as HTTP
 * Basic the way the tools send them, reads it; refused credentials answer 401. A username is the
 * Basic username, so one with a colon is refused unsent. The management URL is one the user
 * chose, so the check runs through the guarded egress, and an answer without a user context (a
 * proxy or login page) is not taken as proof.
 * https://help.splunk.com/en/splunk-enterprise/leverage-rest-apis/rest-api-reference/10.6/access-endpoints/access-endpoint-descriptions
 */
export const validateSplunkServiceAccount = tokenCheckValidator({
  serviceLabel: 'Splunk',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain),
  workspaceId: ({ providerWorkspaceId }) => {
    const username = (providerWorkspaceId ?? '').trim()
    if (!username) return undefined
    if (!/^[^:\x00-\x1f\x7f]+$/.test(username)) throw new Error('invalid username')
    return username
  },
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain = '', providerWorkspaceId }) => ({
    url: buildSplunkUrl({ baseUrl: domain }, '/authentication/current-context'),
    headers: buildSplunkHeaders(
      providerWorkspaceId
        ? { baseUrl: domain, username: providerWorkspaceId, password: apiToken }
        : { baseUrl: domain, authToken: apiToken }
    ),
  }),
  acceptsBody: (body) => {
    const [entry] = toArray(toRecord(body).entry)
    const username = toRecord(toRecord(entry).content).username
    if (typeof username !== 'string' || !username.trim()) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Splunk returned no user context',
      })
    }
    return true
  },
})

/**
 * Listing one domain on the region's host answers 200 for a valid account API key and 401
 * ("Invalid private key") otherwise; a key from the other region is refused the same way, so the
 * check also proves the region. The region is checked first because the tools send any value
 * other than `eu` to the US host. A role-restricted key's JSON 403 still proves the key.
 */
export const validateMailgunServiceAccount = tokenCheckValidator({
  serviceLabel: 'Mailgun',
  domain: allowedDomain(US_OR_EU),
  forbiddenMeansScoped: true,
  request: ({ apiToken, domain }) => ({
    url: `${getMailgunApiBaseUrl(domain as MailgunRegion)}/domains?limit=1`,
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
  }),
})

/** Mem0's ping endpoint (the one its SDK calls on startup) answers 200 for a valid key and 401 otherwise. */
export const validateMem0ServiceAccount = tokenCheckValidator({
  serviceLabel: 'Mem0',
  request: ({ apiToken }) => ({
    url: 'https://api.mem0.ai/v1/ping/',
    headers: { Authorization: `Token ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * The NerdGraph error classes New Relic's own Go client retries: NerdGraph failing to
 * answer, not a verdict on the key.
 * https://github.com/newrelic/newrelic-client-go/blob/main/internal/http/graphql.go
 */
const NERDGRAPH_RETRYABLE_ERROR_CLASSES: ReadonlySet<unknown> = new Set([
  'TIMEOUT',
  'INTERNAL_SERVER_ERROR',
  'SERVER_ERROR',
])

/**
 * A New Relic User API key is bound to its data center, so it is checked against the
 * NerdGraph host of the region typed with it (`us`, `eu`, or `jp`, stored lower-cased because
 * the tools send anything else to the US host). An unknown key, or one from the other
 * region, gets 401, or a 200 whose `errors` carry `BAD_API_KEY`, so only a resolved user
 * proves the key. Only an error in a server class means NerdGraph failed to answer.
 */
export const validateNewRelicServiceAccount = tokenCheckValidator({
  serviceLabel: 'New Relic',
  domain: allowedDomain(NEW_RELIC_REGIONS),
  request: ({ apiToken, domain }) => ({
    url: getNerdGraphEndpoint(domain),
    method: 'POST',
    headers: { ...newRelicHeaders(apiToken), Accept: 'application/json' },
    body: JSON.stringify({ query: '{ actor { user { id } } }' }),
  }),
  acceptsBody: (body) => {
    const { data, errors } = toRecord(body)
    if (toRecord(toRecord(data).actor).user != null) return true
    const failedToAnswer = toArray(errors).some((error) =>
      NERDGRAPH_RETRYABLE_ERROR_CLASSES.has(toRecord(toRecord(error).extensions).errorClass)
    )
    if (failedToAnswer) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'NerdGraph answered with errors and no user',
      })
    }
    return false
  },
})

/**
 * With an API token, Okta's `GET /api/v1/users/me` returns the admin the token acts as on the
 * org whose Okta-owned domain the tools' `validateOktaDomain` accepts; a bad or revoked token
 * gets 401 `E0000011`. A reply without a user id is Okta misbehaving, not a bad token.
 */
export const validateOktaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Okta',
  domain: ({ domain }) => validateOktaDomain(domain ?? ''),
  request: ({ apiToken, domain }) => ({
    url: `https://${domain}/api/v1/users/me`,
    headers: oktaHeaders(apiToken.trim()),
  }),
  acceptsBody: (body) => {
    const id = toRecord(body).id
    if (typeof id !== 'string' || !id) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Okta returned an unexpected user',
      })
    }
    return true
  },
})

/** Otter's workspace endpoint answers 200 for a valid key and 401 otherwise. */
export const validateOtterServiceAccount = tokenCheckValidator({
  serviceLabel: 'Otter.ai',
  request: ({ apiToken }) => ({
    url: 'https://api.otter.ai/v1/workspace',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Listing one PagerDuty user answers 200 for a valid REST API key and 401 for an unknown one; a
 * JSON 403 comes only from an authenticated key whose user lacks access to the user list.
 */
export const validatePagerDutyServiceAccount = tokenCheckValidator({
  serviceLabel: 'PagerDuty',
  request: ({ apiToken }) => ({
    url: 'https://api.pagerduty.com/users?limit=1',
    headers: {
      Authorization: `Token token=${apiToken}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
    },
  }),
  forbiddenMeansScoped: true,
})

/** Listing one inquiry answers 200 for a valid key with inquiry read access and 401 otherwise. */
export const validatePersonaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Persona',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.withpersona.com/api/v1/inquiries?page%5Bsize%5D=1',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Persona-Version': '2025-12-08',
      Accept: 'application/json',
    },
  }),
})

/**
 * The instance URL in the form the tools build on: an http(s) origin plus any reverse-proxy path
 * prefix, without a trailing slash; a bare host is taken as https. `planeApiUrl` applies the tools'
 * own checks (no credentials, query, fragment, dot segments, or /api/vN suffix).
 */
function normalizePlaneInstanceUrl(raw: string | undefined): string {
  const base = normalizeHttpBaseUrl(raw)
  // The tools' own checks: no dot segments or /api/vN suffix.
  planeApiUrl(base, '/api/v1/users/me/')
  return base
}

/**
 * Plane's documented current-user read, served under /api/v1 by Plane Cloud and Community
 * Edition, answers 200 with the user for a valid token on the instance it was typed with, and 401
 * or 403 for a bad one. A reply without a user id is the instance misbehaving.
 */
export const validatePlaneServiceAccount = tokenCheckValidator({
  serviceLabel: 'Plane',
  domain: ({ domain }) => normalizePlaneInstanceUrl(domain),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => {
    let headers: Record<string, string>
    try {
      headers = planeHeaders(apiToken)
    } catch {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'invalid Plane API token',
      })
    }
    return { url: planeApiUrl(domain, '/api/v1/users/me/'), headers }
  },
  acceptsBody: (body) => {
    if (typeof toRecord(body).id !== 'string') {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Plane returned an unexpected current user',
      })
    }
    return true
  },
})

/**
 * Listing the organizations a service token can reach is the read PlanetScale's own docs use, sent
 * with the `<token id>:<token>` Authorization the tools build (`planetScaleHeaders`). A bad ID or
 * token gets 401. PlanetScale documents no meaning for a 403 here, so it rejects like any other
 * refusal. An ID or token the tools' header builder refuses (a colon or whitespace would split
 * the pair) is refused unsent.
 */
export const validatePlanetScaleServiceAccount = tokenCheckValidator({
  serviceLabel: 'PlanetScale',
  workspaceId: ({ providerWorkspaceId }) => {
    const tokenId = (providerWorkspaceId ?? '').trim()
    if (!isPlanetScaleTokenPart(tokenId)) throw new Error('invalid service token ID')
    return tokenId
  },
  request: ({ apiToken, providerWorkspaceId = '' }) => {
    let headers: Record<string, string>
    try {
      headers = planetScaleHeaders({ serviceTokenId: providerWorkspaceId, serviceToken: apiToken })
    } catch {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'invalid PlanetScale service token',
      })
    }
    return { url: `${PLANETSCALE_API_ORIGIN}/v1/organizations`, headers }
  },
})

/** Profound's organization categories endpoint answers 200 for a valid key and 401 otherwise. */
export const validateProfoundServiceAccount = tokenCheckValidator({
  serviceLabel: 'Profound',
  request: ({ apiToken }) => ({
    url: 'https://api.tryprofound.com/v1/org/categories',
    headers: { 'X-API-Key': apiToken, Accept: 'application/json' },
  }),
})

/** Pulse's usage endpoint reads the key's organization for free: 200 for a valid key, 401 otherwise. */
export const validatePulseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Pulse',
  request: ({ apiToken }) => ({
    url: 'https://api.runpulse.com/usage',
    headers: { 'x-api-key': apiToken, Accept: 'application/json' },
  }),
})

/** Listing one Quartr event type answers 200 for a valid key and 401 otherwise. */
export const validateQuartrServiceAccount = tokenCheckValidator({
  serviceLabel: 'Quartr',
  request: ({ apiToken }) => ({
    url: 'https://api.quartr.com/public/v3/event-types?limit=1',
    headers: { 'x-api-key': apiToken, Accept: 'application/json' },
  }),
})

/** QuiverAI's list-models endpoint answers 200 for a valid key and 401 otherwise. */
export const validateQuiverServiceAccount = tokenCheckValidator({
  serviceLabel: 'Quiver',
  request: ({ apiToken }) => ({
    url: 'https://api.quiver.ai/v1/models',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** RB2B's credit balance endpoint answers 200 for a valid key and 401 otherwise. */
export const validateRB2BServiceAccount = tokenCheckValidator({
  serviceLabel: 'RB2B',
  request: ({ apiToken }) => ({
    url: 'https://api.rb2b.com/api/v1/credits',
    headers: { 'Api-Key': apiToken, Accept: 'application/json' },
  }),
})

/** Reducto's list-jobs endpoint answers 200 for a valid key and 401 otherwise; one job, no configs. */
export const validateReductoServiceAccount = tokenCheckValidator({
  serviceLabel: 'Reducto',
  request: ({ apiToken }) => ({
    url: 'https://platform.reducto.ai/jobs?limit=1&exclude_configs=true',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Resend's list-domains endpoint answers 200 for a full-access key. A sending-only key gets a 401
 * named `restricted_api_key`, which still proves Resend authenticated it; an unknown key gets a
 * `validation_error` and an inactive or suspended one a 403, both of which reject it.
 */
export const validateResendServiceAccount = tokenCheckValidator({
  serviceLabel: 'Resend',
  request: ({ apiToken }) => ({
    url: 'https://api.resend.com/domains',
    headers: { Authorization: `Bearer ${apiToken.trim()}`, Accept: 'application/json' },
  }),
  provesKey: (errorBody) => toRecord(errorBody).name === 'restricted_api_key',
})

/** Rippling's current-user endpoint answers 200 for a valid token with the sso-me.read scope and 401 otherwise. */
export const validateRipplingServiceAccount = tokenCheckValidator({
  serviceLabel: 'Rippling',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://rest.ripplingapis.com/sso-me/',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Listing one Rocketlane user answers 200 for a valid key and 401 otherwise. */
export const validateRocketlaneServiceAccount = tokenCheckValidator({
  serviceLabel: 'Rocketlane',
  request: ({ apiToken }) => ({
    url: 'https://api.rocketlane.com/api/1.0/users?pageSize=1',
    headers: { 'api-key': apiToken, Accept: 'application/json' },
  }),
})

/**
 * Listing one Rootly severity (a read every key role has) answers 200 for a valid key and 401
 * for a bad one; a key whose role can't read severities gets the vendor's JSON 403.
 */
export const validateRootlyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Rootly',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.rootly.com/v1/severities?page%5Bsize%5D=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/vnd.api+json' },
  }),
})

/**
 * SendGrid's scopes endpoint lists the scopes of the key that calls it, so any valid key gets 200
 * and a bad one 401. SendGrid serves it on both the global host and the EU host of regional
 * subusers: https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions/retrieve-a-list-of-scopes-for-which-this-user-has-access
 */
export const validateSendGridServiceAccount = tokenCheckValidator({
  serviceLabel: 'SendGrid',
  ...vendorRegion(SENDGRID_REGIONS),
  request: ({ apiToken, domain }) => ({
    url: `${SENDGRID_REGIONS.apiBase(domain)}/scopes`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Listing the token's Sentry organizations answers 200 for a valid token and 401 for a bad one;
 * a token without `org:read` (an organization token, or a narrowly scoped one) gets Sentry's JSON
 * 403. The list is per region, so it is read on the host of the region the token's organization
 * stores its data in: https://docs.sentry.io/api/users/list-your-organizations/
 */
export const validateSentryServiceAccount = tokenCheckValidator({
  serviceLabel: 'Sentry',
  forbiddenMeansScoped: true,
  ...vendorRegion(SENTRY_REGIONS),
  request: ({ apiToken, domain }) => ({
    url: `${SENTRY_REGIONS.apiBase(domain)}/organizations/`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * A typed ServiceNow instance reduced to the https origin the tools build `/api/now/...` paths on:
 * a bare host is taken as https and a pasted console path or query is dropped. Like a self-managed
 * GitLab host, any public https host is allowed (instances on `service-now.com`, custom instance
 * URLs, and self-hosted instances, matching what the earlier block accepted); the
 * `configuredEndpoint` egress check refuses private and loopback addresses, and the saved password
 * only ever goes to the host stored with it.
 */
export function normalizeServiceNowInstanceUrl(raw: string | undefined): string {
  const typed = refuseUnsafeTypedUrl(raw)
  const url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  if (url.protocol !== 'https:') throw new Error('https only')
  return url.origin
}

/**
 * Reading one user id from the Table API is a cheap documented read with the Basic
 * `username:password` the tools send, on the instance it was typed with. ServiceNow answers bad
 * credentials with 401 and a request its ACLs refuse with a JSON 403, which still proves the
 * login. The username is the Basic username, so one with a colon is refused unsent. Only a
 * Table API `result` list proves the login: a hibernating instance answers 200 with a page.
 * A token an OAuth client minted is proven with the same read as a bearer token, the way the
 * tools send it, and has no username.
 */
export const validateServiceNowServiceAccount = tokenCheckValidator({
  serviceLabel: 'ServiceNow',
  domain: ({ domain }) => normalizeServiceNowInstanceUrl(domain),
  workspaceId: ({ providerWorkspaceId, authMethod }) => {
    if (authMethod === CLIENT_CREDENTIALS_AUTH_METHOD) return undefined
    const username = (providerWorkspaceId ?? '').trim()
    if (!/^[^:\x00-\x1f\x7f]+$/.test(username)) throw new Error('invalid username')
    return username
  },
  egress: 'configuredEndpoint',
  forbiddenMeansScoped: true,
  request: ({ apiToken, domain, providerWorkspaceId = '', authMethod }) => ({
    url: `${domain}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`,
    headers: {
      Authorization: serviceNowAuthorization({
        username: providerWorkspaceId,
        password: apiToken,
        accessToken: apiToken,
        ...(authMethod === CLIENT_CREDENTIALS_AUTH_METHOD
          ? { authStyle: SERVICENOW_BEARER_AUTH_STYLE }
          : {}),
      }),
      Accept: 'application/json',
    },
  }),
  acceptsBody: (body) => {
    if (!Array.isArray(toRecord(body).result)) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'ServiceNow returned an unexpected table read',
      })
    }
    return true
  },
})

/** Similarweb's capabilities endpoint costs no data credits and answers 200 only for a valid key. */
export const validateSimilarwebServiceAccount = tokenCheckValidator({
  serviceLabel: 'Similarweb',
  request: ({ apiToken }) => ({
    url: `https://api.similarweb.com/capabilities?api_key=${encodeURIComponent(apiToken)}`,
    headers: { Accept: 'application/json' },
  }),
})

/** Sixtyfour's balance endpoint answers 200 for a valid key and 401 for a missing or invalid one. */
export const validateSixtyfourServiceAccount = tokenCheckValidator({
  serviceLabel: 'Sixtyfour',
  request: ({ apiToken }) => ({
    url: 'https://api.sixtyfour.ai/check-balance',
    headers: { 'x-api-key': apiToken, Accept: 'application/json' },
  }),
})

/** Smartlead answers 401 for an invalid key; listing one email account is the cheapest authenticated read. */
export const validateSmartleadServiceAccount = tokenCheckValidator({
  serviceLabel: 'Smartlead',
  request: ({ apiToken }) => ({
    url: `https://server.smartlead.ai/api/v1/email-accounts/?api_key=${encodeURIComponent(apiToken)}&offset=0&limit=1`,
    headers: { Accept: 'application/json' },
  }),
})

/** Sportmonks' my/usage endpoint reads the token's own usage, so it succeeds only for a valid token. */
export const validateSportmonksServiceAccount = tokenCheckValidator({
  serviceLabel: 'Sportmonks',
  request: ({ apiToken }) => ({
    url: 'https://api.sportmonks.com/v3/my/usage?per_page=1',
    headers: { Authorization: apiToken, Accept: 'application/json' },
  }),
})

/**
 * Square's list-locations read answers 200 for a valid access token and 401 for a bad one, in the
 * environment (production or sandbox) that issued it; a token without the merchant-profile scope
 * gets 403.
 */
export const validateSquareServiceAccount = tokenCheckValidator({
  serviceLabel: 'Square',
  ...vendorRegion(SQUARE_ENVIRONMENTS),
  request: ({ apiToken, domain }) => ({
    url: `${SQUARE_ENVIRONMENTS.apiBase(domain)}/v2/locations`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
})

/**
 * Listing one customer answers 200 for a valid secret key and 401 for an unknown
 * one; a restricted key without customer read access gets Stripe's JSON 403.
 */
export const validateStripeServiceAccount = tokenCheckValidator({
  serviceLabel: 'Stripe',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.stripe.com/v1/customers?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Reduces a typed Supabase project to the bare ref the tools take as `projectId`: the ref, its
 * `<ref>.supabase.co` host, or the project URL, which must then pass `validateSupabaseProjectId`.
 */
function normalizeSupabaseProjectRef(raw: string | undefined): string {
  const typed = (raw ?? '').trim().toLowerCase()
  const host = /^https?:\/\//.test(typed) ? new URL(typed).hostname : typed.replace(/\/+$/, '')
  const ref = host.endsWith('.supabase.co') ? host.slice(0, -'.supabase.co'.length) : host
  const result = validateSupabaseProjectId(ref)
  if (!result.isValid || !result.sanitized) throw new Error('invalid project ref')
  return result.sanitized
}

/**
 * The API gateway key-checks every `/auth/v1/` route but a few open ones, so Auth's settings read
 * on `<ref>.supabase.co` (host built by the tools' `supabaseBaseUrl`) answers 200 for any key of
 * that project (anon, publishable, secret, or service_role) and 401 for a key it doesn't know.
 */
export const validateSupabaseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Supabase',
  domain: ({ domain }) => normalizeSupabaseProjectRef(domain),
  request: ({ apiToken, domain }) => ({
    url: `${supabaseBaseUrl(domain ?? '')}/auth/v1/settings`,
    headers: { apikey: apiToken, Accept: 'application/json' },
  }),
})

/**
 * Listing devices in the token's default tailnet (`-`) answers 200 for a valid token and 401 for a
 * bad one; an OAuth token without the devices scope gets 403.
 */
export const validateTailscaleServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tailscale',
  request: ({ apiToken }) => ({
    url: 'https://api.tailscale.com/api/v2/tailnet/-/devices',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
})

/** Tavily's usage endpoint answers 200 for a valid key and 401 otherwise. */
export const validateTavilyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tavily',
  request: ({ apiToken }) => ({
    url: 'https://api.tavily.com/usage',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Telegram's getMe exists to test a bot token: 200 for a valid one, 401 or 404 otherwise. */
export const validateTelegramServiceAccount = tokenCheckValidator({
  serviceLabel: 'Telegram',
  request: ({ apiToken }) => ({
    url: `https://api.telegram.org/bot${encodeURIComponent(apiToken)}/getMe`,
    headers: { Accept: 'application/json' },
  }),
})

/**
 * Listing Thrive tags is a read with the same Basic `tenantId:apiKey` auth the tools send, on the
 * region host the key belongs to; a bad key or tenant gets 401.
 */
export const validateThriveServiceAccount = tokenCheckValidator({
  serviceLabel: 'Thrive',
  domain: allowedDomain(THRIVE_HOSTS),
  workspaceId: ({ providerWorkspaceId }) => {
    const tenantId = (providerWorkspaceId ?? '').trim()
    // The tenant id is the Basic-auth username: printable ASCII, and no colon, which would split it.
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(tenantId)) throw new Error('invalid tenant id')
    return tenantId
  },
  request: ({ apiToken, domain, providerWorkspaceId = '' }) => ({
    url: `${getThriveBaseUrl(domain, 'v1')}/tags`,
    headers: { ...getThriveHeaders(providerWorkspaceId, apiToken), Accept: 'application/json' },
  }),
})

/**
 * `SELECT 1` on Tinybird's Query API touches no resource and answers 200 for a token with a read
 * scope at the base URL it was typed with. An unknown or other-region token gets a 403 naming an
 * invalid authentication token (and echoing it); any other JSON 403 is a valid token without a
 * read scope, such as an append-only token.
 */
export const validateTinybirdServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tinybird',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain),
  egress: 'configuredEndpoint',
  errorBodyEchoesToken: true,
  forbiddenMeansScoped: true,
  rejectsKey: (errorBody) =>
    String(toRecord(errorBody).error ?? '').includes('invalid authentication token'),
  request: ({ apiToken, domain }) => ({
    url: `${domain}/v0/sql?q=${encodeURIComponent('SELECT 1 FORMAT JSON')}`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Listing one run needs a valid environment secret key; Trigger.dev answers 401 for any other. */
export const validateTriggerDevServiceAccount = tokenCheckValidator({
  serviceLabel: 'Trigger.dev',
  request: ({ apiToken }) => ({
    url: 'https://api.trigger.dev/api/v1/runs?page%5Bsize%5D=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Twilio Account SIDs: AC followed by 32 lowercase hex digits. */
const TWILIO_ACCOUNT_SID = /^AC[0-9a-f]{32}$/

/**
 * The credential holds the account SID plus either its auth token or an API key pair
 * (`SKxxx:secret`, sent as Twilio's Basic username and password for a key). An auth token fetches
 * the account resource (the tools' scheme, `accountSid:authToken`): 200 for a matching pair, 401
 * (code 20003) for a wrong token, an unknown SID, or a SID the token doesn't belong to. A Standard
 * API key may not read the Accounts resource, so a key lists one of the account's phone numbers
 * instead; Twilio refuses that read for a wrong secret or a key of another account. The SID is
 * checked first so it can never rewrite the path, and a value with a colon that isn't a key pair
 * is refused unsent.
 */
export const validateTwilioServiceAccount = tokenCheckValidator({
  serviceLabel: 'Twilio',
  workspaceId: ({ providerWorkspaceId }) => {
    const accountSid = (providerWorkspaceId ?? '').trim()
    if (!TWILIO_ACCOUNT_SID.test(accountSid)) throw new Error('invalid Account SID')
    return accountSid
  },
  request: ({ apiToken, providerWorkspaceId = '' }) => {
    const apiKey = isTwilioApiKeyPair(apiToken)
    if (!apiKey && apiToken.includes(':')) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'neither an auth token nor an API key pair',
      })
    }
    const account = `https://api.twilio.com/2010-04-01/Accounts/${providerWorkspaceId}`
    return {
      url: apiKey ? `${account}/IncomingPhoneNumbers.json?PageSize=1` : `${account}.json`,
      headers: {
        Authorization: twilioAuthorization(providerWorkspaceId, apiToken),
        Accept: 'application/json',
      },
    }
  },
})

/**
 * Listing one form answers 200 for a token with the forms:read scope the
 * Typeform tools need. Typeform answers an unknown token with a 403, so every
 * refusal rejects it.
 */
export const validateTypeformServiceAccount = tokenCheckValidator({
  serviceLabel: 'Typeform',
  request: ({ apiToken }) => ({
    url: 'https://api.typeform.com/forms?page_size=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * PING answers `{"result":"PONG"}` for a standard token; a bad token gets 401. A token whose
 * ACL doesn't allow PING (a read-only or ACL-user token) gets a NOPERM error, which still
 * proves it authenticated. Any http(s) origin is accepted, as the legacy block accepted any
 * URL, so the check goes through the guarded egress.
 */
export const validateUpstashServiceAccount = tokenCheckValidator({
  serviceLabel: 'Upstash',
  domain: ({ domain }) => normalizeHttpBaseUrl(domain),
  egress: 'configuredEndpoint',
  request: ({ apiToken, domain }) => ({
    url: `${domain}/ping`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  provesKey: (errorBody) => /^NOPERM/i.test(String(toRecord(errorBody).error ?? '')),
  acceptsBody: (body) => {
    if (toRecord(body).result !== 'PONG') {
      throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
        step: 'verify',
        reason: 'Upstash returned an unexpected PING reply',
      })
    }
    return true
  },
})

/** UptimeRobot's v3 user/me returns the key owner's profile, so it succeeds only for a valid key. */
export const validateUptimeRobotServiceAccount = tokenCheckValidator({
  serviceLabel: 'UptimeRobot',
  request: ({ apiToken }) => ({
    url: 'https://api.uptimerobot.com/v3/user/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * Vercel's current-user endpoint answers 200 for a valid token. An unknown token
 * gets a 403 flagged `invalidToken`; any other JSON 403 is a valid token
 * without access to the user record.
 */
export const validateVercelServiceAccount = tokenCheckValidator({
  serviceLabel: 'Vercel',
  forbiddenMeansScoped: true,
  rejectsKey: (errorBody) => toRecord(toRecord(errorBody).error).invalidToken === true,
  request: ({ apiToken }) => ({
    url: 'https://api.vercel.com/v2/user',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/**
 * The Graph API's /me answers 200 for any valid access token and a 4xx
 * OAuthException (code 190) for an invalid, expired, or revoked one.
 */
export const validateWhatsAppServiceAccount = tokenCheckValidator({
  serviceLabel: 'WhatsApp',
  request: ({ apiToken }) => ({
    url: `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/me?fields=id`,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** You.com's account balance read costs no credits and answers 200 only for a valid key. */
export const validateYouComServiceAccount = tokenCheckValidator({
  serviceLabel: 'You.com',
  request: ({ apiToken }) => ({
    url: 'https://api.you.com/v1/billing/account_balance',
    headers: { 'X-API-Key': apiToken, Accept: 'application/json' },
  }),
})

/**
 * Google's 403 reasons for a valid key that is only out of quota for now. Mirrors
 * `isGoogleQuotaReason` in the Google connectors, whose module is too heavy for this graph.
 */
const YOUTUBE_QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'RATE_LIMIT_EXCEEDED',
])

/**
 * Listing video categories costs one quota unit. Google answers 400 for an invalid key and 403
 * for a restricted one or a project without the YouTube API; a 403 for spent quota still proves
 * the key, so only that one is accepted.
 */
export const validateYouTubeServiceAccount = tokenCheckValidator({
  serviceLabel: 'YouTube',
  request: ({ apiToken }) => ({
    url: `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=${encodeURIComponent(apiToken)}`,
    headers: { Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
  rejectsKey: (errorBody) => {
    const error = toRecord(toRecord(errorBody).error)
    if (error.code !== 403) return false
    return !toArray(error.errors).some((entry) =>
      YOUTUBE_QUOTA_REASONS.has(String(toRecord(entry).reason))
    )
  },
})

/** Listing one thread needs a valid project key; Zep answers 401 for any other. */
export const validateZepServiceAccount = tokenCheckValidator({
  serviceLabel: 'Zep',
  request: ({ apiToken }) => ({
    url: 'https://api.getzep.com/api/v2/threads?page_size=1&page_number=1',
    headers: { Authorization: `Api-Key ${apiToken}`, Accept: 'application/json' },
  }),
})
