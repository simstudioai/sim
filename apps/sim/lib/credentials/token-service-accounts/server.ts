import type { ServiceAccountPrincipal } from '@/lib/credentials/principal'
import {
  AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID,
  AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID,
  AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID,
  AHREFS_SERVICE_ACCOUNT_PROVIDER_ID,
  AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID,
  APIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  APOLLO_SERVICE_ACCOUNT_PROVIDER_ID,
  ASANA_SERVICE_ACCOUNT_PROVIDER_ID,
  ATTIO_SERVICE_ACCOUNT_PROVIDER_ID,
  BREX_SERVICE_ACCOUNT_PROVIDER_ID,
  BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID,
  BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID,
  BUFFER_SERVICE_ACCOUNT_PROVIDER_ID,
  CALCOM_SERVICE_ACCOUNT_PROVIDER_ID,
  CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID,
  CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID,
  CLERK_SERVICE_ACCOUNT_PROVIDER_ID,
  CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID,
  CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID,
  CODA_SERVICE_ACCOUNT_PROVIDER_ID,
  CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID,
  CURSOR_SERVICE_ACCOUNT_PROVIDER_ID,
  DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID,
  DISCORD_SERVICE_ACCOUNT_PROVIDER_ID,
  DUB_SERVICE_ACCOUNT_PROVIDER_ID,
  ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID,
  ENRICH_SERVICE_ACCOUNT_PROVIDER_ID,
  EXTEND_SERVICE_ACCOUNT_PROVIDER_ID,
  FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID,
  FLINT_SERVICE_ACCOUNT_PROVIDER_ID,
  FLOW_SERVICE_ACCOUNT_PROVIDER_ID,
  GAMMA_SERVICE_ACCOUNT_PROVIDER_ID,
  GAUGE_SERVICE_ACCOUNT_PROVIDER_ID,
  HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID,
  HEX_SERVICE_ACCOUNT_PROVIDER_ID,
  HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID,
  HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID,
  HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID,
  INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID,
  INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID,
  INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID,
  isTokenServiceAccountProviderId,
  LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID,
  LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID,
  LINEAR_SERVICE_ACCOUNT_PROVIDER_ID,
  LINQ_SERVICE_ACCOUNT_PROVIDER_ID,
  LOOPS_SERVICE_ACCOUNT_PROVIDER_ID,
  LUMA_SERVICE_ACCOUNT_PROVIDER_ID,
  MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID,
  MEM0_SERVICE_ACCOUNT_PROVIDER_ID,
  MONDAY_SERVICE_ACCOUNT_PROVIDER_ID,
  NOTION_SERVICE_ACCOUNT_PROVIDER_ID,
  OTTER_SERVICE_ACCOUNT_PROVIDER_ID,
  PERSONA_SERVICE_ACCOUNT_PROVIDER_ID,
  PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID,
  PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID,
  PULSE_SERVICE_ACCOUNT_PROVIDER_ID,
  QUARTR_SERVICE_ACCOUNT_PROVIDER_ID,
  QUIVER_SERVICE_ACCOUNT_PROVIDER_ID,
  RB2B_SERVICE_ACCOUNT_PROVIDER_ID,
  REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID,
  RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID,
  ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID,
  SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID,
  SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID,
  SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID,
  SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID,
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID,
  SQUARE_SERVICE_ACCOUNT_PROVIDER_ID,
  TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID,
  TAVILY_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
  type TokenServiceAccountProviderId,
  TRELLO_SERVICE_ACCOUNT_PROVIDER_ID,
  TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID,
  UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID,
  WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID,
  WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID,
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
  validateApifyServiceAccount,
  validateApolloServiceAccount,
  validateBrexServiceAccount,
  validateBrightDataServiceAccount,
  validateBrowserUseServiceAccount,
  validateBufferServiceAccount,
  validateCirclebackServiceAccount,
  validateClerkServiceAccount,
  validateCloudflareServiceAccount,
  validateCrunchbaseServiceAccount,
  validateCursorServiceAccount,
  validateDaytonaServiceAccount,
  validateDiscordServiceAccount,
  validateDubServiceAccount,
  validateElevenLabsServiceAccount,
  validateEnrichServiceAccount,
  validateExtendServiceAccount,
  validateFirefliesServiceAccount,
  validateFlintServiceAccount,
  validateGammaServiceAccount,
  validateHexServiceAccount,
  validateHuggingfaceServiceAccount,
  validateIncidentioServiceAccount,
  validateInstantlyServiceAccount,
  validateIntercomServiceAccount,
  validateLangsmithServiceAccount,
  validateLaunchdarklyServiceAccount,
  validateLinqServiceAccount,
  validateLoopsServiceAccount,
  validateLumaServiceAccount,
  validateMailchimpServiceAccount,
  validateMem0ServiceAccount,
  validateOtterServiceAccount,
  validatePersonaServiceAccount,
  validateProfoundServiceAccount,
  validatePulseServiceAccount,
  validateQuartrServiceAccount,
  validateQuiverServiceAccount,
  validateRB2BServiceAccount,
  validateReductoServiceAccount,
  validateRipplingServiceAccount,
  validateRocketlaneServiceAccount,
  validateSendGridServiceAccount,
  validateSimilarwebServiceAccount,
  validateSixtyfourServiceAccount,
  validateSmartleadServiceAccount,
  validateSportmonksServiceAccount,
  validateSquareServiceAccount,
  validateTailscaleServiceAccount,
  validateTavilyServiceAccount,
  validateTriggerDevServiceAccount,
  validateUptimeRobotServiceAccount,
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
  [BREX_SERVICE_ACCOUNT_PROVIDER_ID]: validateBrexServiceAccount,
  [APOLLO_SERVICE_ACCOUNT_PROVIDER_ID]: validateApolloServiceAccount,
  [APIFY_SERVICE_ACCOUNT_PROVIDER_ID]: validateApifyServiceAccount,
  [AHREFS_SERVICE_ACCOUNT_PROVIDER_ID]: validateAhrefsServiceAccount,
  [AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID]: validateAgentPhoneServiceAccount,
  [AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID]: validateAgentMailServiceAccount,
  [AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID]: validateAffinityServiceAccount,
  [TAVILY_SERVICE_ACCOUNT_PROVIDER_ID]: validateTavilyServiceAccount,
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

export function parseTokenServiceAccountSecretBlob(
  decrypted: string,
  expectedProviderId: string
): TokenServiceAccountSecretBlob {
  const parsed = JSON.parse(decrypted) as TokenServiceAccountSecretBlob
  if (
    parsed.type !== TOKEN_SERVICE_ACCOUNT_SECRET_TYPE ||
    parsed.providerId !== expectedProviderId ||
    !parsed.apiToken
  ) {
    throw new Error('Stored token service-account secret is malformed')
  }
  return parsed
}
