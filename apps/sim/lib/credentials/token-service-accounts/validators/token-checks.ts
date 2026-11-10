import { toArray, toRecord } from '@sim/utils/object'
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
  readJsonBody,
  tokenCheckValidator,
} from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * Token checks for saved-credential providers whose key is verified by one
 * documented, read-only request. Most are declarations for
 * `tokenCheckValidator`; the few that need more (a host taken from the key, an
 * unknown-id lookup) sit alongside. Kept in one module so each new provider
 * costs a declaration, not a module, in every graph that verifies credentials.
 */

/** Affinity's whoami endpoint answers 200 for a valid key and 401 otherwise. */
export const validateAffinityServiceAccount = tokenCheckValidator({
  serviceLabel: 'Affinity',
  request: ({ apiToken }) => ({
    url: 'https://api.affinity.co/v2/auth/whoami',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Listing one AgentMail inbox answers 200 for a valid key and 403 otherwise. */
export const validateAgentMailServiceAccount = tokenCheckValidator({
  serviceLabel: 'AgentMail',
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

/** ElevenLabs returns the key owner's account for a valid key and 401 otherwise. */
export const validateElevenLabsServiceAccount = tokenCheckValidator({
  serviceLabel: 'ElevenLabs',
  request: ({ apiToken }) => ({
    url: 'https://api.elevenlabs.io/v1/user',
    headers: { 'xi-api-key': apiToken, Accept: 'application/json' },
  }),
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

/** Verifies a Flint API key. */
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

/** Hex's list-projects endpoint (the one the Hex tools call) answers 200 for a valid token and 401 otherwise. */
export const validateHexServiceAccount = tokenCheckValidator({
  serviceLabel: 'Hex',
  request: ({ apiToken }) => ({
    url: 'https://app.hex.tech/api/v1/projects?limit=1',
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

/** Instantly's campaign list (the one the Instantly tools call) answers 200 for a valid key and 401 otherwise. */
export const validateInstantlyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Instantly',
  request: ({ apiToken }) => ({
    url: 'https://api.instantly.ai/api/v2/campaigns?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
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

/** LangSmith's workspace list answers 200 for a valid API key and 401/403 otherwise. */
export const validateLangsmithServiceAccount = tokenCheckValidator({
  serviceLabel: 'LangSmith',
  request: ({ apiToken }) => ({
    url: 'https://api.smith.langchain.com/api/v1/workspaces',
    headers: { 'X-Api-Key': apiToken, Accept: 'application/json' },
  }),
})

/** LaunchDarkly's caller-identity endpoint describes the calling token, so it answers 200 for any valid token and 401 otherwise. */
export const validateLaunchdarklyServiceAccount = tokenCheckValidator({
  serviceLabel: 'LaunchDarkly',
  request: ({ apiToken }) => ({
    url: 'https://app.launchdarkly.com/api/v2/caller-identity',
    headers: { Authorization: apiToken, Accept: 'application/json' },
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

/** Mem0's ping endpoint (the one its SDK calls on startup) answers 200 for a valid key and 401 otherwise. */
export const validateMem0ServiceAccount = tokenCheckValidator({
  serviceLabel: 'Mem0',
  request: ({ apiToken }) => ({
    url: 'https://api.mem0.ai/v1/ping/',
    headers: { Authorization: `Token ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Otter's workspace endpoint answers 200 for a valid key and 401 otherwise. */
export const validateOtterServiceAccount = tokenCheckValidator({
  serviceLabel: 'Otter.ai',
  request: ({ apiToken }) => ({
    url: 'https://api.otter.ai/v1/workspace',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
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

/** SendGrid's scopes endpoint lists the scopes of the key that calls it, so any valid key gets 200 and a bad one 401. */
export const validateSendGridServiceAccount = tokenCheckValidator({
  serviceLabel: 'SendGrid',
  request: ({ apiToken }) => ({
    url: 'https://api.sendgrid.com/v3/scopes',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
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

/** Square's list-locations read answers 200 for a valid production access token and 401 otherwise. */
export const validateSquareServiceAccount = tokenCheckValidator({
  serviceLabel: 'Square',
  request: ({ apiToken }) => ({
    url: 'https://connect.squareup.com/v2/locations',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Listing devices in the token's default tailnet (`-`) answers 200 for a valid token and 401 otherwise. */
export const validateTailscaleServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tailscale',
  request: ({ apiToken }) => ({
    url: 'https://api.tailscale.com/api/v2/tailnet/-/devices',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})

/** Tavily's usage endpoint answers 200 for a valid key and 401 otherwise. */
export const validateTavilyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tavily',
  request: ({ apiToken }) => ({
    url: 'https://api.tavily.com/usage',
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

/** UptimeRobot's v3 user/me returns the key owner's profile, so it succeeds only for a valid key. */
export const validateUptimeRobotServiceAccount = tokenCheckValidator({
  serviceLabel: 'UptimeRobot',
  request: ({ apiToken }) => ({
    url: 'https://api.uptimerobot.com/v3/user/me',
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

/** Listing video categories costs one quota unit; Google answers 400/403 for an invalid or restricted key. */
export const validateYouTubeServiceAccount = tokenCheckValidator({
  serviceLabel: 'YouTube',
  request: ({ apiToken }) => ({
    url: `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=${encodeURIComponent(apiToken)}`,
    headers: { Accept: 'application/json' },
  }),
})

/** Listing one thread needs a valid project key; Zep answers 401 for any other. */
export const validateZepServiceAccount = tokenCheckValidator({
  serviceLabel: 'Zep',
  request: ({ apiToken }) => ({
    url: 'https://api.getzep.com/api/v2/threads?page_size=1&page_number=1',
    headers: { Authorization: `Api-Key ${apiToken}`, Accept: 'application/json' },
  }),
})
