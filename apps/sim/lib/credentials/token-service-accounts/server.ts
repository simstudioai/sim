import { isRecordLike } from '@sim/utils/object'
import type { ServiceAccountPrincipal } from '@/lib/credentials/principal'
import {
  AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID,
  AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID,
  AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID,
  AHREFS_SERVICE_ACCOUNT_PROVIDER_ID,
  AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID,
  ALGOLIA_SERVICE_ACCOUNT_PROVIDER_ID,
  APIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  APOLLO_SERVICE_ACCOUNT_PROVIDER_ID,
  ASANA_SERVICE_ACCOUNT_PROVIDER_ID,
  ASHBY_SERVICE_ACCOUNT_PROVIDER_ID,
  ATTIO_SERVICE_ACCOUNT_PROVIDER_ID,
  AZURE_DEVOPS_SERVICE_ACCOUNT_PROVIDER_ID,
  BITBUCKET_SERVICE_ACCOUNT_PROVIDER_ID,
  BREX_SERVICE_ACCOUNT_PROVIDER_ID,
  BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID,
  BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID,
  BUFFER_SERVICE_ACCOUNT_PROVIDER_ID,
  CALCOM_SERVICE_ACCOUNT_PROVIDER_ID,
  CALENDLY_SERVICE_ACCOUNT_PROVIDER_ID,
  CHECKR_SERVICE_ACCOUNT_PROVIDER_ID,
  CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID,
  CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID,
  CLERK_SERVICE_ACCOUNT_PROVIDER_ID,
  CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID,
  CLIENT_CREDENTIALS_AUTH_METHOD,
  CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID,
  CODA_SERVICE_ACCOUNT_PROVIDER_ID,
  CONVEX_SERVICE_ACCOUNT_PROVIDER_ID,
  CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID,
  CURSOR_SERVICE_ACCOUNT_PROVIDER_ID,
  DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID,
  DEVIN_SERVICE_ACCOUNT_PROVIDER_ID,
  DISCORD_SERVICE_ACCOUNT_PROVIDER_ID,
  DUB_SERVICE_ACCOUNT_PROVIDER_ID,
  DYNATRACE_SERVICE_ACCOUNT_PROVIDER_ID,
  ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID,
  EMAILBISON_SERVICE_ACCOUNT_PROVIDER_ID,
  ENRICH_SERVICE_ACCOUNT_PROVIDER_ID,
  EXTEND_SERVICE_ACCOUNT_PROVIDER_ID,
  FATHOM_SERVICE_ACCOUNT_PROVIDER_ID,
  FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID,
  FLINT_SERVICE_ACCOUNT_PROVIDER_ID,
  FLOW_SERVICE_ACCOUNT_PROVIDER_ID,
  GAMMA_SERVICE_ACCOUNT_PROVIDER_ID,
  GAUGE_SERVICE_ACCOUNT_PROVIDER_ID,
  GITHUB_SERVICE_ACCOUNT_PROVIDER_ID,
  GITLAB_SERVICE_ACCOUNT_PROVIDER_ID,
  GONG_SERVICE_ACCOUNT_PROVIDER_ID,
  GRAFANA_SERVICE_ACCOUNT_PROVIDER_ID,
  GRAIN_SERVICE_ACCOUNT_PROVIDER_ID,
  GRANOLA_SERVICE_ACCOUNT_PROVIDER_ID,
  HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID,
  HEX_SERVICE_ACCOUNT_PROVIDER_ID,
  HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID,
  HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID,
  HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID,
  INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID,
  INFISICAL_SERVICE_ACCOUNT_PROVIDER_ID,
  INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID,
  INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID,
  isTokenServiceAccountProviderId,
  JOTFORM_SERVICE_ACCOUNT_PROVIDER_ID,
  JUPYTER_SERVICE_ACCOUNT_PROVIDER_ID,
  LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID,
  LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID,
  LEMLIST_SERVICE_ACCOUNT_PROVIDER_ID,
  LINEAR_SERVICE_ACCOUNT_PROVIDER_ID,
  LINQ_SERVICE_ACCOUNT_PROVIDER_ID,
  LOGFIRE_SERVICE_ACCOUNT_PROVIDER_ID,
  LOOPS_SERVICE_ACCOUNT_PROVIDER_ID,
  LUMA_SERVICE_ACCOUNT_PROVIDER_ID,
  MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID,
  MAILGUN_SERVICE_ACCOUNT_PROVIDER_ID,
  MEM0_SERVICE_ACCOUNT_PROVIDER_ID,
  MONDAY_SERVICE_ACCOUNT_PROVIDER_ID,
  NEW_RELIC_SERVICE_ACCOUNT_PROVIDER_ID,
  NOTION_SERVICE_ACCOUNT_PROVIDER_ID,
  OKTA_SERVICE_ACCOUNT_PROVIDER_ID,
  OTTER_SERVICE_ACCOUNT_PROVIDER_ID,
  PAGERDUTY_SERVICE_ACCOUNT_PROVIDER_ID,
  PERSONA_SERVICE_ACCOUNT_PROVIDER_ID,
  PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID,
  PLANE_SERVICE_ACCOUNT_PROVIDER_ID,
  PLANETSCALE_SERVICE_ACCOUNT_PROVIDER_ID,
  PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID,
  PULSE_SERVICE_ACCOUNT_PROVIDER_ID,
  QUARTR_SERVICE_ACCOUNT_PROVIDER_ID,
  QUIVER_SERVICE_ACCOUNT_PROVIDER_ID,
  RB2B_SERVICE_ACCOUNT_PROVIDER_ID,
  REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID,
  RESEND_SERVICE_ACCOUNT_PROVIDER_ID,
  RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID,
  ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID,
  ROOTLY_SERVICE_ACCOUNT_PROVIDER_ID,
  SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID,
  SENTRY_SERVICE_ACCOUNT_PROVIDER_ID,
  SERVICENOW_SERVICE_ACCOUNT_PROVIDER_ID,
  SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID,
  SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID,
  SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID,
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID,
  SQUARE_SERVICE_ACCOUNT_PROVIDER_ID,
  STRIPE_SERVICE_ACCOUNT_PROVIDER_ID,
  SUPABASE_SERVICE_ACCOUNT_PROVIDER_ID,
  TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID,
  TAVILY_SERVICE_ACCOUNT_PROVIDER_ID,
  TELEGRAM_SERVICE_ACCOUNT_PROVIDER_ID,
  THRIVE_SERVICE_ACCOUNT_PROVIDER_ID,
  TINYBIRD_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
  type TokenServiceAccountProviderId,
  TRELLO_SERVICE_ACCOUNT_PROVIDER_ID,
  TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID,
  TWILIO_SERVICE_ACCOUNT_PROVIDER_ID,
  TYPEFORM_SERVICE_ACCOUNT_PROVIDER_ID,
  UPSTASH_SERVICE_ACCOUNT_PROVIDER_ID,
  UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID,
  VERCEL_SERVICE_ACCOUNT_PROVIDER_ID,
  WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID,
  WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID,
  WHATSAPP_SERVICE_ACCOUNT_PROVIDER_ID,
  YOUCOM_SERVICE_ACCOUNT_PROVIDER_ID,
  YOUTUBE_SERVICE_ACCOUNT_PROVIDER_ID,
  ZEP_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { validateAirtableServiceAccount } from '@/lib/credentials/token-service-accounts/validators/airtable'
import { validateAsanaServiceAccount } from '@/lib/credentials/token-service-accounts/validators/asana'
import { validateAttioServiceAccount } from '@/lib/credentials/token-service-accounts/validators/attio'
import { validateCalcomServiceAccount } from '@/lib/credentials/token-service-accounts/validators/calcom'
import { validateClaudePlatformServiceAccount } from '@/lib/credentials/token-service-accounts/validators/claude-platform'
import { validateClickupServiceAccount } from '@/lib/credentials/token-service-accounts/validators/clickup'
import { validateCodaServiceAccount } from '@/lib/credentials/token-service-accounts/validators/coda'
import { validateFlowServiceAccount } from '@/lib/credentials/token-service-accounts/validators/flow'
import { validateGaugeServiceAccount } from '@/lib/credentials/token-service-accounts/validators/gauge'
import { validateHarmonicServiceAccount } from '@/lib/credentials/token-service-accounts/validators/harmonic'
import { validateHiggsfieldServiceAccount } from '@/lib/credentials/token-service-accounts/validators/higgsfield'
import { validateHubspotServiceAccount } from '@/lib/credentials/token-service-accounts/validators/hubspot'
import { validateLinearServiceAccount } from '@/lib/credentials/token-service-accounts/validators/linear'
import { validateMondayServiceAccount } from '@/lib/credentials/token-service-accounts/validators/monday'
import { validateNotionServiceAccount } from '@/lib/credentials/token-service-accounts/validators/notion'
import { validatePipedriveServiceAccount } from '@/lib/credentials/token-service-accounts/validators/pipedrive'
import { validateShopifyServiceAccount } from '@/lib/credentials/token-service-accounts/validators/shopify'
import { validateSnowflakeServiceAccount } from '@/lib/credentials/token-service-accounts/validators/snowflake'
import {
  validateAffinityServiceAccount,
  validateAgentMailServiceAccount,
  validateAgentPhoneServiceAccount,
  validateAhrefsServiceAccount,
  validateAlgoliaServiceAccount,
  validateApifyServiceAccount,
  validateApolloServiceAccount,
  validateAshbyServiceAccount,
  validateAzureDevOpsServiceAccount,
  validateBitbucketServiceAccount,
  validateBrexServiceAccount,
  validateBrightDataServiceAccount,
  validateBrowserUseServiceAccount,
  validateBufferServiceAccount,
  validateCalendlyServiceAccount,
  validateCheckrServiceAccount,
  validateCirclebackServiceAccount,
  validateClerkServiceAccount,
  validateCloudflareServiceAccount,
  validateConvexServiceAccount,
  validateCrunchbaseServiceAccount,
  validateCursorServiceAccount,
  validateDaytonaServiceAccount,
  validateDevinServiceAccount,
  validateDiscordServiceAccount,
  validateDubServiceAccount,
  validateDynatraceServiceAccount,
  validateElevenLabsServiceAccount,
  validateEmailBisonServiceAccount,
  validateEnrichServiceAccount,
  validateExtendServiceAccount,
  validateFathomServiceAccount,
  validateFirefliesServiceAccount,
  validateFlintServiceAccount,
  validateGammaServiceAccount,
  validateGitHubServiceAccount,
  validateGitLabServiceAccount,
  validateGongServiceAccount,
  validateGrafanaServiceAccount,
  validateGrainServiceAccount,
  validateGranolaServiceAccount,
  validateHexServiceAccount,
  validateHuggingfaceServiceAccount,
  validateIncidentioServiceAccount,
  validateInfisicalServiceAccount,
  validateInstantlyServiceAccount,
  validateIntercomServiceAccount,
  validateJotformServiceAccount,
  validateJupyterServiceAccount,
  validateLangsmithServiceAccount,
  validateLaunchdarklyServiceAccount,
  validateLemlistServiceAccount,
  validateLinqServiceAccount,
  validateLogfireServiceAccount,
  validateLoopsServiceAccount,
  validateLumaServiceAccount,
  validateMailchimpServiceAccount,
  validateMailgunServiceAccount,
  validateMem0ServiceAccount,
  validateNewRelicServiceAccount,
  validateOktaServiceAccount,
  validateOtterServiceAccount,
  validatePagerDutyServiceAccount,
  validatePersonaServiceAccount,
  validatePlaneServiceAccount,
  validatePlanetScaleServiceAccount,
  validateProfoundServiceAccount,
  validatePulseServiceAccount,
  validateQuartrServiceAccount,
  validateQuiverServiceAccount,
  validateRB2BServiceAccount,
  validateReductoServiceAccount,
  validateResendServiceAccount,
  validateRipplingServiceAccount,
  validateRocketlaneServiceAccount,
  validateRootlyServiceAccount,
  validateSendGridServiceAccount,
  validateSentryServiceAccount,
  validateServiceNowServiceAccount,
  validateSimilarwebServiceAccount,
  validateSixtyfourServiceAccount,
  validateSmartleadServiceAccount,
  validateSportmonksServiceAccount,
  validateSquareServiceAccount,
  validateStripeServiceAccount,
  validateSupabaseServiceAccount,
  validateTailscaleServiceAccount,
  validateTavilyServiceAccount,
  validateTelegramServiceAccount,
  validateThriveServiceAccount,
  validateTinybirdServiceAccount,
  validateTriggerDevServiceAccount,
  validateTwilioServiceAccount,
  validateTypeformServiceAccount,
  validateUpstashServiceAccount,
  validateUptimeRobotServiceAccount,
  validateVercelServiceAccount,
  validateWhatsAppServiceAccount,
  validateYouComServiceAccount,
  validateYouTubeServiceAccount,
  validateZepServiceAccount,
} from '@/lib/credentials/token-service-accounts/validators/token-checks'
import { validateTrelloServiceAccount } from '@/lib/credentials/token-service-accounts/validators/trello'
import { validateWealthboxServiceAccount } from '@/lib/credentials/token-service-accounts/validators/wealthbox'
import { validateWebflowServiceAccount } from '@/lib/credentials/token-service-accounts/validators/webflow'

/** Raw fields a token service-account validator receives (already trimmed). */
export interface TokenServiceAccountFields {
  apiToken: string
  domain?: string
  providerWorkspaceId?: string
  /**
   * `client_credentials` when `apiToken` was just minted from the provider's client-credentials
   * grant rather than pasted, for checks whose identity differs between the two (a Linear app
   * actor). Absent for a pasted token.
   */
  authMethod?: typeof CLIENT_CREDENTIALS_AUTH_METHOD
}

/** Result of a successful provider verification. */
export interface TokenServiceAccountValidationResult {
  /** Default display name when the user didn't provide one. */
  displayName: string
  /**
   * Identity the token authenticates as, or `null` when the provider exposes
   * none. Required (never optional) so a new validator cannot be written
   * without deciding. `verifyAndBuildServiceAccountSecret` mirrors it into both
   * `auditMetadata` and `storedMetadata`, so validators must not repeat it.
   */
  principal: ServiceAccountPrincipal | null
  /**
   * Non-secret identifiers recorded in the audit log that are NOT the
   * principal (e.g. the org id behind a user principal).
   */
  auditMetadata: Record<string, string>
  /**
   * Non-secret metadata persisted inside the encrypted blob alongside the
   * token (e.g. normalized store domain, granted scopes) for later debugging.
   */
  storedMetadata?: Record<string, string>
  /** Normalized domain to persist instead of the raw user input (when collected). */
  normalizedDomain?: string
  /** Normalized account id to persist instead of the raw user input (when collected). */
  normalizedWorkspaceId?: string
}

export type TokenServiceAccountValidator = (
  fields: TokenServiceAccountFields
) => Promise<TokenServiceAccountValidationResult>

/**
 * Server-side verification registry for token service-account providers. Keys
 * must stay in lockstep with `TOKEN_SERVICE_ACCOUNT_DESCRIPTORS` — a
 * descriptor without a validator fails loudly at create time.
 */
const TOKEN_SERVICE_ACCOUNT_VALIDATORS: Record<
  TokenServiceAccountProviderId,
  TokenServiceAccountValidator
> = {
  [HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID]: validateHubspotServiceAccount,
  [AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID]: validateAirtableServiceAccount,
  [NOTION_SERVICE_ACCOUNT_PROVIDER_ID]: validateNotionServiceAccount,
  [ASANA_SERVICE_ACCOUNT_PROVIDER_ID]: validateAsanaServiceAccount,
  [ATTIO_SERVICE_ACCOUNT_PROVIDER_ID]: validateAttioServiceAccount,
  [CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID]: validateClickupServiceAccount,
  [HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID]: validateHarmonicServiceAccount,
  [LINEAR_SERVICE_ACCOUNT_PROVIDER_ID]: validateLinearServiceAccount,
  [MONDAY_SERVICE_ACCOUNT_PROVIDER_ID]: validateMondayServiceAccount,
  [SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID]: validateShopifyServiceAccount,
  [WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID]: validateWebflowServiceAccount,
  [TRELLO_SERVICE_ACCOUNT_PROVIDER_ID]: validateTrelloServiceAccount,
  [CALCOM_SERVICE_ACCOUNT_PROVIDER_ID]: validateCalcomServiceAccount,
  [WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID]: validateWealthboxServiceAccount,
  [PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID]: validatePipedriveServiceAccount,
  [CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID]: validateClaudePlatformServiceAccount,
  [SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID]: validateSnowflakeServiceAccount,
  [CODA_SERVICE_ACCOUNT_PROVIDER_ID]: validateCodaServiceAccount,
  [GAUGE_SERVICE_ACCOUNT_PROVIDER_ID]: validateGaugeServiceAccount,
  [HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID]: validateHiggsfieldServiceAccount,
  [FLOW_SERVICE_ACCOUNT_PROVIDER_ID]: validateFlowServiceAccount,
  [FLINT_SERVICE_ACCOUNT_PROVIDER_ID]: validateFlintServiceAccount,
  [REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID]: validateReductoServiceAccount,
  [QUIVER_SERVICE_ACCOUNT_PROVIDER_ID]: validateQuiverServiceAccount,
  [PULSE_SERVICE_ACCOUNT_PROVIDER_ID]: validatePulseServiceAccount,
  [INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID]: validateIntercomServiceAccount,
  [FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID]: validateFirefliesServiceAccount,
  [EXTEND_SERVICE_ACCOUNT_PROVIDER_ID]: validateExtendServiceAccount,
  [DUB_SERVICE_ACCOUNT_PROVIDER_ID]: validateDubServiceAccount,
  [CURSOR_SERVICE_ACCOUNT_PROVIDER_ID]: validateCursorServiceAccount,
  [DISCORD_SERVICE_ACCOUNT_PROVIDER_ID]: validateDiscordServiceAccount,
  [ZEP_SERVICE_ACCOUNT_PROVIDER_ID]: validateZepServiceAccount,
  [MEM0_SERVICE_ACCOUNT_PROVIDER_ID]: validateMem0ServiceAccount,
  [YOUTUBE_SERVICE_ACCOUNT_PROVIDER_ID]: validateYouTubeServiceAccount,
  [YOUCOM_SERVICE_ACCOUNT_PROVIDER_ID]: validateYouComServiceAccount,
  [UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID]: validateUptimeRobotServiceAccount,
  [TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID]: validateTriggerDevServiceAccount,
  [TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID]: validateTailscaleServiceAccount,
  [SQUARE_SERVICE_ACCOUNT_PROVIDER_ID]: validateSquareServiceAccount,
  [SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID]: validateSportmonksServiceAccount,
  [SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID]: validateSmartleadServiceAccount,
  [SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID]: validateSixtyfourServiceAccount,
  [SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID]: validateSimilarwebServiceAccount,
  [SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID]: validateSendGridServiceAccount,
  [ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID]: validateRocketlaneServiceAccount,
  [RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID]: validateRipplingServiceAccount,
  [RB2B_SERVICE_ACCOUNT_PROVIDER_ID]: validateRB2BServiceAccount,
  [QUARTR_SERVICE_ACCOUNT_PROVIDER_ID]: validateQuartrServiceAccount,
  [PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID]: validateProfoundServiceAccount,
  [PERSONA_SERVICE_ACCOUNT_PROVIDER_ID]: validatePersonaServiceAccount,
  [OTTER_SERVICE_ACCOUNT_PROVIDER_ID]: validateOtterServiceAccount,
  [MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID]: validateMailchimpServiceAccount,
  [LUMA_SERVICE_ACCOUNT_PROVIDER_ID]: validateLumaServiceAccount,
  [LOOPS_SERVICE_ACCOUNT_PROVIDER_ID]: validateLoopsServiceAccount,
  [LINQ_SERVICE_ACCOUNT_PROVIDER_ID]: validateLinqServiceAccount,
  [LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID]: validateLaunchdarklyServiceAccount,
  [LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID]: validateLangsmithServiceAccount,
  [INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID]: validateInstantlyServiceAccount,
  [INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID]: validateIncidentioServiceAccount,
  [HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID]: validateHuggingfaceServiceAccount,
  [HEX_SERVICE_ACCOUNT_PROVIDER_ID]: validateHexServiceAccount,
  [GAMMA_SERVICE_ACCOUNT_PROVIDER_ID]: validateGammaServiceAccount,
  [ENRICH_SERVICE_ACCOUNT_PROVIDER_ID]: validateEnrichServiceAccount,
  [ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID]: validateElevenLabsServiceAccount,
  [DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID]: validateDaytonaServiceAccount,
  [CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID]: validateCrunchbaseServiceAccount,
  [CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID]: validateCloudflareServiceAccount,
  [CLERK_SERVICE_ACCOUNT_PROVIDER_ID]: validateClerkServiceAccount,
  [CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID]: validateCirclebackServiceAccount,
  [BUFFER_SERVICE_ACCOUNT_PROVIDER_ID]: validateBufferServiceAccount,
  [BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID]: validateBrowserUseServiceAccount,
  [BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID]: validateBrightDataServiceAccount,
  [BITBUCKET_SERVICE_ACCOUNT_PROVIDER_ID]: validateBitbucketServiceAccount,
  [BREX_SERVICE_ACCOUNT_PROVIDER_ID]: validateBrexServiceAccount,
  [APOLLO_SERVICE_ACCOUNT_PROVIDER_ID]: validateApolloServiceAccount,
  [APIFY_SERVICE_ACCOUNT_PROVIDER_ID]: validateApifyServiceAccount,
  [AHREFS_SERVICE_ACCOUNT_PROVIDER_ID]: validateAhrefsServiceAccount,
  [AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID]: validateAgentPhoneServiceAccount,
  [AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID]: validateAgentMailServiceAccount,
  [AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID]: validateAffinityServiceAccount,
  [TAVILY_SERVICE_ACCOUNT_PROVIDER_ID]: validateTavilyServiceAccount,
  [ALGOLIA_SERVICE_ACCOUNT_PROVIDER_ID]: validateAlgoliaServiceAccount,
  [ASHBY_SERVICE_ACCOUNT_PROVIDER_ID]: validateAshbyServiceAccount,
  [AZURE_DEVOPS_SERVICE_ACCOUNT_PROVIDER_ID]: validateAzureDevOpsServiceAccount,
  [CALENDLY_SERVICE_ACCOUNT_PROVIDER_ID]: validateCalendlyServiceAccount,
  [CHECKR_SERVICE_ACCOUNT_PROVIDER_ID]: validateCheckrServiceAccount,
  [CONVEX_SERVICE_ACCOUNT_PROVIDER_ID]: validateConvexServiceAccount,
  [DEVIN_SERVICE_ACCOUNT_PROVIDER_ID]: validateDevinServiceAccount,
  [DYNATRACE_SERVICE_ACCOUNT_PROVIDER_ID]: validateDynatraceServiceAccount,
  [EMAILBISON_SERVICE_ACCOUNT_PROVIDER_ID]: validateEmailBisonServiceAccount,
  [FATHOM_SERVICE_ACCOUNT_PROVIDER_ID]: validateFathomServiceAccount,
  [GITHUB_SERVICE_ACCOUNT_PROVIDER_ID]: validateGitHubServiceAccount,
  [GITLAB_SERVICE_ACCOUNT_PROVIDER_ID]: validateGitLabServiceAccount,
  [GONG_SERVICE_ACCOUNT_PROVIDER_ID]: validateGongServiceAccount,
  [GRAFANA_SERVICE_ACCOUNT_PROVIDER_ID]: validateGrafanaServiceAccount,
  [GRAIN_SERVICE_ACCOUNT_PROVIDER_ID]: validateGrainServiceAccount,
  [GRANOLA_SERVICE_ACCOUNT_PROVIDER_ID]: validateGranolaServiceAccount,
  [INFISICAL_SERVICE_ACCOUNT_PROVIDER_ID]: validateInfisicalServiceAccount,
  [JOTFORM_SERVICE_ACCOUNT_PROVIDER_ID]: validateJotformServiceAccount,
  [JUPYTER_SERVICE_ACCOUNT_PROVIDER_ID]: validateJupyterServiceAccount,
  [LEMLIST_SERVICE_ACCOUNT_PROVIDER_ID]: validateLemlistServiceAccount,
  [LOGFIRE_SERVICE_ACCOUNT_PROVIDER_ID]: validateLogfireServiceAccount,
  [MAILGUN_SERVICE_ACCOUNT_PROVIDER_ID]: validateMailgunServiceAccount,
  [NEW_RELIC_SERVICE_ACCOUNT_PROVIDER_ID]: validateNewRelicServiceAccount,
  [OKTA_SERVICE_ACCOUNT_PROVIDER_ID]: validateOktaServiceAccount,
  [PAGERDUTY_SERVICE_ACCOUNT_PROVIDER_ID]: validatePagerDutyServiceAccount,
  [PLANE_SERVICE_ACCOUNT_PROVIDER_ID]: validatePlaneServiceAccount,
  [PLANETSCALE_SERVICE_ACCOUNT_PROVIDER_ID]: validatePlanetScaleServiceAccount,
  [RESEND_SERVICE_ACCOUNT_PROVIDER_ID]: validateResendServiceAccount,
  [ROOTLY_SERVICE_ACCOUNT_PROVIDER_ID]: validateRootlyServiceAccount,
  [SENTRY_SERVICE_ACCOUNT_PROVIDER_ID]: validateSentryServiceAccount,
  [SERVICENOW_SERVICE_ACCOUNT_PROVIDER_ID]: validateServiceNowServiceAccount,
  [STRIPE_SERVICE_ACCOUNT_PROVIDER_ID]: validateStripeServiceAccount,
  [SUPABASE_SERVICE_ACCOUNT_PROVIDER_ID]: validateSupabaseServiceAccount,
  [TELEGRAM_SERVICE_ACCOUNT_PROVIDER_ID]: validateTelegramServiceAccount,
  [THRIVE_SERVICE_ACCOUNT_PROVIDER_ID]: validateThriveServiceAccount,
  [TINYBIRD_SERVICE_ACCOUNT_PROVIDER_ID]: validateTinybirdServiceAccount,
  [TWILIO_SERVICE_ACCOUNT_PROVIDER_ID]: validateTwilioServiceAccount,
  [TYPEFORM_SERVICE_ACCOUNT_PROVIDER_ID]: validateTypeformServiceAccount,
  [UPSTASH_SERVICE_ACCOUNT_PROVIDER_ID]: validateUpstashServiceAccount,
  [VERCEL_SERVICE_ACCOUNT_PROVIDER_ID]: validateVercelServiceAccount,
  [WHATSAPP_SERVICE_ACCOUNT_PROVIDER_ID]: validateWhatsAppServiceAccount,
}

export function getTokenServiceAccountValidator(
  providerId: string
): TokenServiceAccountValidator | undefined {
  return isTokenServiceAccountProviderId(providerId)
    ? TOKEN_SERVICE_ACCOUNT_VALIDATORS[providerId]
    : undefined
}

/**
 * Shape of the decrypted secret blob persisted for token service accounts.
 * `providerId` is stored inside the blob so a mismatched credential row fails
 * loudly at resolution time instead of returning another provider's token.
 */
export interface TokenServiceAccountSecretBlob {
  type: typeof TOKEN_SERVICE_ACCOUNT_SECRET_TYPE
  providerId: string
  apiToken: string
  domain?: string
  providerWorkspaceId?: string
  metadata?: Record<string, string>
}

/**
 * Secret blob for a token provider's client-credentials mode: the client ID and secret it mints
 * with replace the pasted token. Only providers declaring `clientCredentials` write it.
 */
export interface TokenServiceAccountClientCredentialBlob {
  type: typeof TOKEN_SERVICE_ACCOUNT_SECRET_TYPE
  providerId: string
  authMethod: typeof CLIENT_CREDENTIALS_AUTH_METHOD
  clientId: string
  clientSecret: string
  domain?: string
  metadata?: Record<string, string>
}

/**
 * Parses a pasted-token blob. A client-credentials blob has no token and is refused, so callers
 * that only understand pasted tokens (Snowflake) fail closed on one.
 */
export function parseTokenServiceAccountSecretBlob(
  decrypted: string,
  expectedProviderId: string
): TokenServiceAccountSecretBlob {
  const parsed = parseTokenServiceAccountSecret(decrypted, expectedProviderId)
  if ('authMethod' in parsed) {
    throw new Error('Stored token service-account secret is malformed')
  }
  return parsed
}

/** The credential a stored secret blob holds: a pasted token, or a client-credentials pair. */
export type StoredSecretMode =
  | { apiToken: string }
  | { authMethod: typeof CLIENT_CREDENTIALS_AUTH_METHOD; clientId: string; clientSecret: string }

/**
 * Reads which credential a parsed secret blob was saved with: no `authMethod` means a pasted
 * token, and the client-credentials method means a client ID and secret to mint with. Returns
 * `undefined` for a blob missing the fields its mode needs, or naming another method.
 */
export function parseStoredSecretMode(
  parsed: Record<string, unknown>
): StoredSecretMode | undefined {
  if (parsed.authMethod === undefined) {
    return typeof parsed.apiToken === 'string' && parsed.apiToken
      ? { apiToken: parsed.apiToken }
      : undefined
  }
  if (
    parsed.authMethod !== CLIENT_CREDENTIALS_AUTH_METHOD ||
    typeof parsed.clientId !== 'string' ||
    !parsed.clientId ||
    typeof parsed.clientSecret !== 'string' ||
    !parsed.clientSecret
  ) {
    return undefined
  }
  return {
    authMethod: CLIENT_CREDENTIALS_AUTH_METHOD,
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
  }
}

/** Parses either mode of a token provider's secret blob, checking it belongs to the provider. */
export function parseTokenServiceAccountSecret(
  decrypted: string,
  expectedProviderId: string
): TokenServiceAccountSecretBlob | TokenServiceAccountClientCredentialBlob {
  const malformed = new Error('Stored token service-account secret is malformed')
  const parsed: unknown = JSON.parse(decrypted)
  if (
    !isRecordLike(parsed) ||
    parsed.type !== TOKEN_SERVICE_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId
  ) {
    throw malformed
  }
  const mode = parseStoredSecretMode(parsed)
  if (!mode) throw malformed
  const optional = {
    ...(typeof parsed.domain === 'string' ? { domain: parsed.domain } : {}),
    ...(isRecordLike(parsed.metadata)
      ? { metadata: parsed.metadata as Record<string, string> }
      : {}),
  }
  const base: Pick<TokenServiceAccountSecretBlob, 'type' | 'providerId'> = {
    type: TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
    providerId: expectedProviderId,
  }
  if ('authMethod' in mode) return { ...base, ...mode, ...optional }
  return {
    ...base,
    ...mode,
    ...(typeof parsed.providerWorkspaceId === 'string'
      ? { providerWorkspaceId: parsed.providerWorkspaceId }
      : {}),
    ...optional,
  }
}
