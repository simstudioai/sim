/**
 * Client-safe descriptors for token-paste service-account providers.
 *
 * A token service account is a `service_account`-type credential where a
 * workspace admin pastes a long-lived provider token (private-app token, PAT,
 * API key, …) instead of running an OAuth flow — mirroring the Atlassian
 * service-account pattern: the token is verified once server-side, encrypted,
 * and returned as the access token at execution time with no exchange or
 * refresh. This module holds the client-safe UI/contract metadata (field
 * lists, labels, docs links) plus pure derivations over it (required-field
 * lookups, connect-modal error copy); server-side verification lives in
 * `@/lib/credentials/token-service-accounts/server`.
 */

/** Discriminator stored inside every encrypted token service-account secret blob. */
export const TOKEN_SERVICE_ACCOUNT_SECRET_TYPE = 'token_service_account' as const

/** Contract field ids a token service-account modal may collect. */
export type TokenServiceAccountFieldId = 'apiToken' | 'domain' | 'providerWorkspaceId'

export interface TokenServiceAccountField {
  id: TokenServiceAccountFieldId
  label: string
  placeholder: string
  /** Rendered with SecretInput and never echoed back. */
  secret: boolean
  /** Preserve exact password bytes instead of normalizing surrounding whitespace. */
  preserveWhitespace?: boolean
  /**
   * The value is a URL whose scheme and path matter (a self-hosted instance or
   * deployment URL), so the connect form sends it as typed and the provider's
   * check normalizes it. Other domains are reduced to a bare host first.
   */
  url?: boolean
  /** Soft-format hint shown while the current value doesn't match `hintPattern`. */
  hintPattern?: RegExp
  hintMessage?: string
}

export interface TokenServiceAccountDescriptor {
  /** Stable credential `providerId` (`<provider>-service-account`). */
  providerId: string
  /** Human service label used in modal copy and error messages (e.g. "HubSpot"). */
  serviceLabel: string
  /** Vendor noun for the pasted secret (e.g. "private app access token"). */
  tokenNoun: string
  /**
   * Short vendor-accurate noun for connect-surface labels ("Add {connectNoun}").
   * These providers don't have literal "service accounts" — the UI uses the
   * vendor's own vocabulary for the credential.
   */
  connectNoun: string
  fields: TokenServiceAccountField[]
  /** Sim setup guide, docked bottom-left of the connect modal. */
  docsUrl: string
  /** Optional one-line caveat rendered under the token field. */
  helpText?: string
  /**
   * Optional provider-specific message that replaces the generic
   * `invalid_credentials` rejection copy. Use it to name the exact
   * credential-paste mistake most users make (e.g. copying the API secret key
   * instead of the Admin API access token) rather than a vague "double-check".
   */
  invalidCredentialsHelp?: string
  /**
   * HTTP auth scheme the pasted token requires at execution time. Defaults to
   * `bearer` (`Authorization: Bearer <token>`); `x-api-token` providers (e.g.
   * Pipedrive) send the token in an `x-api-token` header instead, and the
   * token route surfaces this so tool header builders can switch schemes.
   */
  authStyle?: 'bearer' | 'x-api-token'
  /**
   * A client-credentials grant the provider offers beside the pasted token. A credential saved
   * with `authMethod: 'client_credentials'` stores the client ID and secret (and `domain`, when
   * the descriptor has one) and mints a short-lived token at execution time; a credential saved
   * without it keeps the pasted-token mode unchanged.
   */
  clientCredentials?: TokenServiceAccountClientCredentials
}

/** Copy for a token provider's client-credentials mode in the connect modal. */
interface TokenServiceAccountClientCredentials {
  /** Authentication dropdown label for the client-credentials mode. */
  label: string
  /** Authentication dropdown label for the existing pasted-token mode. */
  tokenLabel: string
  /** Guidance shown under the client ID field. */
  helpText: string
  /** Replaces the generic `invalid_credentials` copy for this mode. */
  invalidCredentialsHelp: string
  /** Copy for `grant_not_permitted`, when the provider can refuse the grant for one account. */
  notPermittedHelp?: string
  /**
   * Preselects this mode for a new connection, for providers whose current setup no longer
   * issues a pasted token. A reconnect preselects nothing; the admin restates the mode while
   * retyping the secret.
   */
  preferred?: boolean
}

/** `authMethod` value selecting the client-credentials mode of a provider whose default is a pasted token (a token provider, or the Atlassian service account). */
export const CLIENT_CREDENTIALS_AUTH_METHOD = 'client_credentials' as const

export const HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID = 'hubspot-service-account' as const
export const AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID = 'airtable-service-account' as const
export const NOTION_SERVICE_ACCOUNT_PROVIDER_ID = 'notion-service-account' as const
export const ASANA_SERVICE_ACCOUNT_PROVIDER_ID = 'asana-service-account' as const
export const ATTIO_SERVICE_ACCOUNT_PROVIDER_ID = 'attio-service-account' as const
export const HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID = 'harmonic-service-account' as const
export const CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID = 'clickup-service-account' as const
export const LINEAR_SERVICE_ACCOUNT_PROVIDER_ID = 'linear-service-account' as const
export const MONDAY_SERVICE_ACCOUNT_PROVIDER_ID = 'monday-service-account' as const
export const SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID = 'shopify-service-account' as const
export const WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID = 'webflow-service-account' as const
export const TRELLO_SERVICE_ACCOUNT_PROVIDER_ID = 'trello-service-account' as const
export const CALCOM_SERVICE_ACCOUNT_PROVIDER_ID = 'calcom-service-account' as const
export const WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID = 'wealthbox-service-account' as const
export const PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID = 'pipedrive-service-account' as const
export const CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID =
  'claude-platform-service-account' as const
export const SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID = 'snowflake-service-account' as const
export const FLOW_SERVICE_ACCOUNT_PROVIDER_ID = 'flow-service-account' as const
export const CODA_SERVICE_ACCOUNT_PROVIDER_ID = 'coda-service-account' as const
export const GAUGE_SERVICE_ACCOUNT_PROVIDER_ID = 'gauge-service-account' as const
export const HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID = 'higgsfield-service-account' as const
export const THRIVE_SERVICE_ACCOUNT_PROVIDER_ID = 'thrive-service-account' as const
export const PLANETSCALE_SERVICE_ACCOUNT_PROVIDER_ID = 'planetscale-service-account' as const
export const GONG_SERVICE_ACCOUNT_PROVIDER_ID = 'gong-service-account' as const
export const SERVICENOW_SERVICE_ACCOUNT_PROVIDER_ID = 'servicenow-service-account' as const
export const SUPABASE_SERVICE_ACCOUNT_PROVIDER_ID = 'supabase-service-account' as const
export const INFISICAL_SERVICE_ACCOUNT_PROVIDER_ID = 'infisical-service-account' as const
export const OKTA_SERVICE_ACCOUNT_PROVIDER_ID = 'okta-service-account' as const
export const DEVIN_SERVICE_ACCOUNT_PROVIDER_ID = 'devin-service-account' as const
export const EMAILBISON_SERVICE_ACCOUNT_PROVIDER_ID = 'emailbison-service-account' as const
export const UPSTASH_SERVICE_ACCOUNT_PROVIDER_ID = 'upstash-service-account' as const
export const ALGOLIA_SERVICE_ACCOUNT_PROVIDER_ID = 'algolia-service-account' as const
/**
 * The Twilio credential's `apiToken` holds either the account auth token or an API key pair
 * (`SKxxx:secret`), deliberately in one field: the pair is exactly the Basic username and password
 * Twilio takes for a key, so every surface (saved credential, inline block field, API) carries it
 * with no extra field. Build request auth only with `twilioAuthorization`; a consumer that needs
 * the account auth token itself (webhook signature HMAC) must refuse a value `isTwilioApiKeyPair`
 * matches, since an API key secret cannot sign.
 */
export const TWILIO_SERVICE_ACCOUNT_PROVIDER_ID = 'twilio-service-account' as const
export const AZURE_DEVOPS_SERVICE_ACCOUNT_PROVIDER_ID = 'azure-devops-service-account' as const
export const PLANE_SERVICE_ACCOUNT_PROVIDER_ID = 'plane-service-account' as const
export const JOTFORM_SERVICE_ACCOUNT_PROVIDER_ID = 'jotform-service-account' as const
export const MAILGUN_SERVICE_ACCOUNT_PROVIDER_ID = 'mailgun-service-account' as const
export const LOGFIRE_SERVICE_ACCOUNT_PROVIDER_ID = 'logfire-service-account' as const
export const NEW_RELIC_SERVICE_ACCOUNT_PROVIDER_ID = 'new-relic-service-account' as const
export const DYNATRACE_SERVICE_ACCOUNT_PROVIDER_ID = 'dynatrace-service-account' as const
export const TINYBIRD_SERVICE_ACCOUNT_PROVIDER_ID = 'tinybird-service-account' as const
export const CONVEX_SERVICE_ACCOUNT_PROVIDER_ID = 'convex-service-account' as const
export const JUPYTER_SERVICE_ACCOUNT_PROVIDER_ID = 'jupyter-service-account' as const
export const GRAFANA_SERVICE_ACCOUNT_PROVIDER_ID = 'grafana-service-account' as const
export const GITLAB_SERVICE_ACCOUNT_PROVIDER_ID = 'gitlab-service-account' as const
export const GITHUB_SERVICE_ACCOUNT_PROVIDER_ID = 'github-service-account' as const
export const BITBUCKET_SERVICE_ACCOUNT_PROVIDER_ID = 'bitbucket-service-account' as const
export const WHATSAPP_SERVICE_ACCOUNT_PROVIDER_ID = 'whatsapp-service-account' as const
export const VERCEL_SERVICE_ACCOUNT_PROVIDER_ID = 'vercel-service-account' as const
export const TYPEFORM_SERVICE_ACCOUNT_PROVIDER_ID = 'typeform-service-account' as const
export const TELEGRAM_SERVICE_ACCOUNT_PROVIDER_ID = 'telegram-service-account' as const
export const STRIPE_SERVICE_ACCOUNT_PROVIDER_ID = 'stripe-service-account' as const
export const SENTRY_SERVICE_ACCOUNT_PROVIDER_ID = 'sentry-service-account' as const
export const ROOTLY_SERVICE_ACCOUNT_PROVIDER_ID = 'rootly-service-account' as const
export const RESEND_SERVICE_ACCOUNT_PROVIDER_ID = 'resend-service-account' as const
export const PAGERDUTY_SERVICE_ACCOUNT_PROVIDER_ID = 'pagerduty-service-account' as const
export const LEMLIST_SERVICE_ACCOUNT_PROVIDER_ID = 'lemlist-service-account' as const
export const GRANOLA_SERVICE_ACCOUNT_PROVIDER_ID = 'granola-service-account' as const
export const GRAIN_SERVICE_ACCOUNT_PROVIDER_ID = 'grain-service-account' as const
export const FATHOM_SERVICE_ACCOUNT_PROVIDER_ID = 'fathom-service-account' as const
export const CHECKR_SERVICE_ACCOUNT_PROVIDER_ID = 'checkr-service-account' as const
export const CALENDLY_SERVICE_ACCOUNT_PROVIDER_ID = 'calendly-service-account' as const
export const ASHBY_SERVICE_ACCOUNT_PROVIDER_ID = 'ashby-service-account' as const
export const FLINT_SERVICE_ACCOUNT_PROVIDER_ID = 'flint-service-account' as const
export const REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID = 'reducto-service-account' as const
export const QUIVER_SERVICE_ACCOUNT_PROVIDER_ID = 'quiver-service-account' as const
export const PULSE_SERVICE_ACCOUNT_PROVIDER_ID = 'pulse-service-account' as const
export const INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID = 'intercom-service-account' as const
export const FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID = 'fireflies-service-account' as const
export const EXTEND_SERVICE_ACCOUNT_PROVIDER_ID = 'extend-service-account' as const
export const DUB_SERVICE_ACCOUNT_PROVIDER_ID = 'dub-service-account' as const
export const CURSOR_SERVICE_ACCOUNT_PROVIDER_ID = 'cursor-service-account' as const
export const DISCORD_SERVICE_ACCOUNT_PROVIDER_ID = 'discord-service-account' as const
export const ZEP_SERVICE_ACCOUNT_PROVIDER_ID = 'zep-service-account' as const
export const MEM0_SERVICE_ACCOUNT_PROVIDER_ID = 'mem0-service-account' as const
export const YOUTUBE_SERVICE_ACCOUNT_PROVIDER_ID = 'youtube-service-account' as const
export const YOUCOM_SERVICE_ACCOUNT_PROVIDER_ID = 'youcom-service-account' as const
export const UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID = 'uptimerobot-service-account' as const
export const TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID = 'trigger-dev-service-account' as const
export const TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID = 'tailscale-service-account' as const
export const SQUARE_SERVICE_ACCOUNT_PROVIDER_ID = 'square-service-account' as const
export const SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID = 'sportmonks-service-account' as const
export const SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID = 'smartlead-service-account' as const
export const SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID = 'sixtyfour-service-account' as const
export const SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID = 'similarweb-service-account' as const
export const SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID = 'sendgrid-service-account' as const
export const ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID = 'rocketlane-service-account' as const
export const RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID = 'rippling-service-account' as const
export const RB2B_SERVICE_ACCOUNT_PROVIDER_ID = 'rb2b-service-account' as const
export const QUARTR_SERVICE_ACCOUNT_PROVIDER_ID = 'quartr-service-account' as const
export const PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID = 'profound-service-account' as const
export const PERSONA_SERVICE_ACCOUNT_PROVIDER_ID = 'persona-service-account' as const
export const OTTER_SERVICE_ACCOUNT_PROVIDER_ID = 'otter-service-account' as const
export const MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID = 'mailchimp-service-account' as const
export const LUMA_SERVICE_ACCOUNT_PROVIDER_ID = 'luma-service-account' as const
export const LOOPS_SERVICE_ACCOUNT_PROVIDER_ID = 'loops-service-account' as const
export const LINQ_SERVICE_ACCOUNT_PROVIDER_ID = 'linq-service-account' as const
export const LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID = 'launchdarkly-service-account' as const
export const LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID = 'langsmith-service-account' as const
export const INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID = 'instantly-service-account' as const
export const INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID = 'incidentio-service-account' as const
export const HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID = 'huggingface-service-account' as const
export const HEX_SERVICE_ACCOUNT_PROVIDER_ID = 'hex-service-account' as const
export const GAMMA_SERVICE_ACCOUNT_PROVIDER_ID = 'gamma-service-account' as const
export const ENRICH_SERVICE_ACCOUNT_PROVIDER_ID = 'enrich-service-account' as const
export const ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID = 'elevenlabs-service-account' as const
export const DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID = 'daytona-service-account' as const
export const CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID = 'crunchbase-service-account' as const
export const CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID = 'cloudflare-service-account' as const
export const CLERK_SERVICE_ACCOUNT_PROVIDER_ID = 'clerk-service-account' as const
export const CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID = 'circleback-service-account' as const
export const BUFFER_SERVICE_ACCOUNT_PROVIDER_ID = 'buffer-service-account' as const
export const BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID = 'browser-use-service-account' as const
export const BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID = 'brightdata-service-account' as const
export const BREX_SERVICE_ACCOUNT_PROVIDER_ID = 'brex-service-account' as const
export const APOLLO_SERVICE_ACCOUNT_PROVIDER_ID = 'apollo-service-account' as const
export const APIFY_SERVICE_ACCOUNT_PROVIDER_ID = 'apify-service-account' as const
export const AHREFS_SERVICE_ACCOUNT_PROVIDER_ID = 'ahrefs-service-account' as const
export const AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID = 'agentphone-service-account' as const
export const AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID = 'agentmail-service-account' as const
export const AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID = 'affinity-service-account' as const
export const TAVILY_SERVICE_ACCOUNT_PROVIDER_ID = 'tavily-service-account' as const

const SHOPIFY_DOMAIN_HINT_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i

/**
 * Account hostnames carry a variable number of labels — `myorg-myaccount`,
 * but also the legacy `xy12345.us-east-1` locator form — so dots are allowed
 * before the `snowflakecomputing` suffix. China accounts use `.cn`.
 */
const SNOWFLAKE_HOST_HINT_REGEX = /^[a-z0-9][a-z0-9.-]*\.snowflakecomputing\.(com|cn)$/i

export type TokenServiceAccountProviderId =
  | typeof HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof NOTION_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ASANA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ATTIO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LINEAR_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MONDAY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TRELLO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CALCOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CODA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GAUGE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof THRIVE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PLANETSCALE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GONG_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SERVICENOW_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SUPABASE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof INFISICAL_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof OKTA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DEVIN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof EMAILBISON_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof UPSTASH_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ALGOLIA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TWILIO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AZURE_DEVOPS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PLANE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof JOTFORM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MAILGUN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LOGFIRE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof NEW_RELIC_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DYNATRACE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TINYBIRD_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CONVEX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof JUPYTER_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GRAFANA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GITLAB_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GITHUB_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BITBUCKET_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof WHATSAPP_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof VERCEL_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TYPEFORM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TELEGRAM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof STRIPE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SENTRY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ROOTLY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof RESEND_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PAGERDUTY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LEMLIST_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GRANOLA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GRAIN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof FATHOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CHECKR_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CALENDLY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ASHBY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof FLINT_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof QUIVER_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PULSE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof EXTEND_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DUB_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CURSOR_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DISCORD_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ZEP_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MEM0_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof YOUTUBE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof YOUCOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SQUARE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof RB2B_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof QUARTR_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof PERSONA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof OTTER_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LUMA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LOOPS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LINQ_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof HEX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GAMMA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ENRICH_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CLERK_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BUFFER_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BREX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof APOLLO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof APIFY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AHREFS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TAVILY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof FLOW_SERVICE_ACCOUNT_PROVIDER_ID

export const TOKEN_SERVICE_ACCOUNT_DESCRIPTORS: Record<
  TokenServiceAccountProviderId,
  TokenServiceAccountDescriptor
> = {
  [HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'HubSpot',
    tokenNoun: 'service key or private app access token',
    connectNoun: 'service key',
    fields: [
      {
        id: 'apiToken',
        label: 'Service key or private app token',
        placeholder: 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        secret: true,
        hintPattern: /^pat-/i,
        hintMessage: 'HubSpot service keys and private app tokens usually start with pat-.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/hubspot-service-account',
    helpText:
      'Create a service key in HubSpot under Development > Keys > Service keys (or Settings > Integrations > Service keys, depending on your account); new legacy private apps can no longer be created, but existing private app tokens keep working. If the key rotates automatically, paste the new key here after each rotation.',
  },
  [AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Airtable',
    tokenNoun: 'personal access token',
    connectNoun: 'personal access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Personal access token',
        placeholder: 'pat...',
        secret: true,
        hintPattern: /^pat/i,
        hintMessage: 'Airtable personal access tokens usually start with pat.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/airtable-service-account',
    helpText:
      'Enterprise Scale service-account tokens work here too — they use the same format as personal access tokens.',
  },
  [NOTION_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: NOTION_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Notion',
    tokenNoun: 'internal integration secret',
    connectNoun: 'integration secret',
    fields: [
      {
        id: 'apiToken',
        label: 'Internal integration secret',
        placeholder: 'ntn_...',
        secret: true,
        hintPattern: /^(ntn_|secret_)/,
        hintMessage: 'Notion integration secrets usually start with ntn_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/notion-service-account',
    helpText:
      'Newer Notion UIs label the secret "installation access token". Remember to connect the integration to the pages and databases it should access — a valid secret with no page connections can read nothing.',
  },
  [ASANA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ASANA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Asana',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste a service account token or personal access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/asana-service-account',
    helpText:
      'Enterprise service account tokens and personal access tokens both work — they use the same format.',
  },
  [ATTIO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ATTIO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Attio',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste workspace API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/attio-service-account',
    helpText:
      'Check the scopes granted to the key in Attio — tools whose scopes are missing will fail at run time.',
  },
  [HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Harmonic',
    tokenNoun: 'team API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'Team API key',
        placeholder: 'Paste Harmonic team API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/harmonic',
  },
  [CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CLICKUP_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'ClickUp',
    tokenNoun: 'personal API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'pk_...',
        secret: true,
        hintPattern: /^pk_/,
        hintMessage: 'ClickUp personal API tokens start with pk_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/clickup-service-account',
  },
  [LINEAR_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LINEAR_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Linear',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'lin_api_...',
        secret: true,
        hintPattern: /^lin_api_/,
        hintMessage: 'Linear personal API keys start with lin_api_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/linear-service-account',
    clientCredentials: {
      label: 'OAuth app (client credentials)',
      tokenLabel: 'Personal API key (lin_api_)',
      helpText:
        'Turn on client credentials tokens for the OAuth app in Linear first, and use an OAuth app only Sim uses: requesting a token replaces an existing authorization of this app in the workspace, a client-credentials request for it with other scopes revokes Sim’s tokens, and rotating the client secret invalidates its tokens until you reconnect here.',
      invalidCredentialsHelp:
        'Linear rejected these client credentials. Check the client ID and secret, and that client credentials tokens are turned on for the OAuth app.',
    },
  },
  [MONDAY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MONDAY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'monday.com',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste personal API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/monday-service-account',
    helpText:
      'monday.com issues one API token per user — regenerating it in monday breaks every integration using the old token.',
  },
  [SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Shopify',
    tokenNoun: 'Admin API access token',
    connectNoun: 'admin API token',
    fields: [
      {
        id: 'apiToken',
        label: 'Admin API access token',
        placeholder: 'shpat_...',
        secret: true,
        hintPattern: /^shpat_/,
        hintMessage: 'Shopify Admin API access tokens usually start with shpat_.',
      },
      {
        id: 'domain',
        label: 'Store domain',
        placeholder: 'your-store.myshopify.com',
        secret: false,
        hintPattern: SHOPIFY_DOMAIN_HINT_REGEX,
        hintMessage: 'Shopify store domains look like your-store.myshopify.com.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/shopify-service-account',
    helpText:
      'Only custom apps created in the Shopify admin reveal this token. For an app created in the Dev Dashboard, choose Client credentials instead.',
    invalidCredentialsHelp:
      'Shopify rejected this token. Make sure you copied the Admin API access token (starts with shpat_) — not the API key or API secret key — for an app installed on this exact store domain, and that it has not since been revoked or regenerated.',
    clientCredentials: {
      preferred: true,
      label: 'Client credentials (Dev Dashboard app)',
      tokenLabel: 'Admin API access token (shpat_)',
      helpText:
        'Use the client ID and secret from the Dev Dashboard app. The app must be installed on this store, and the app and store must belong to the same Shopify organization.',
      invalidCredentialsHelp:
        'Shopify rejected these client credentials. Check that the client ID and secret belong to a Dev Dashboard app that is installed on this exact store domain.',
      notPermittedHelp:
        'Shopify does not allow client credentials for this store. Client credentials only work when the app and the store belong to the same Shopify organization, so check that this store is part of the organization that owns the app.',
    },
  },
  [WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Webflow',
    tokenNoun: 'site API token',
    connectNoun: 'site token',
    fields: [
      {
        id: 'apiToken',
        label: 'Site API token',
        placeholder: 'Paste site API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/webflow-service-account',
    helpText:
      'Site tokens expire after 365 days without API activity, and each token grants access to a single site.',
    invalidCredentialsHelp:
      'Webflow rejected this token, or it reaches no site. Generate a site API token in the site settings with at least the sites:read scope.',
  },
  [TRELLO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TRELLO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Trello',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/trello-service-account',
    helpText:
      'A read-only or short-expiration token validates here and then fails at run time — Sim cannot tell either from the token itself.',
  },
  [CALCOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CALCOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Cal.com',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'cal_live_...',
        secret: true,
        hintPattern: /^cal_/,
        hintMessage: 'Cal.com API keys usually start with cal_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/calcom-service-account',
    helpText:
      'Cal.com preselects a 30-day expiry when you create a key — switch on "Never expires" or runs stop on that date.',
  },
  [WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Wealthbox',
    tokenNoun: 'API access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'API access token',
        placeholder: 'Paste API access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/wealthbox-service-account',
    helpText:
      'An expired trial can block Wealthbox API access. Contact Wealthbox support if API Access is missing from your Settings.',
    invalidCredentialsHelp:
      'Wealthbox rejected this token. Check that it is still active under API Access in your Wealthbox settings, and that the account is not on an expired trial. If the same token works elsewhere, note that Sim authenticates with a Bearer header — a token Wealthbox accepts only over its ACCESS_TOKEN header is refused here.',
  },
  [PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PIPEDRIVE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Pipedrive',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste personal API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/pipedrive-service-account',
    helpText:
      'Each Pipedrive user has one API token per company — regenerating it breaks every integration using the old value, and API-token traffic gets lower rate limits than OAuth.',
    authStyle: 'x-api-token',
  },
  [CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Claude Platform',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'sk-ant-...',
        secret: true,
        hintPattern: /^sk-ant-/,
        hintMessage: 'Claude Platform API keys usually start with sk-ant-.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/managed-agent',
  },
  [FLOW_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: FLOW_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Flow Engineering',
    tokenNoun: 'personal API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'brd_...', secret: true },
      {
        id: 'domain',
        label: 'API host',
        placeholder: 'backend.branch.flowengineering.com',
        secret: false,
      },
      {
        id: 'providerWorkspaceId',
        label: 'Flow workspace identifier',
        placeholder: 'Workspace identifier from your MCP URL',
        secret: false,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/flow',
    helpText:
      'Copy your API key, API host, and workspace identifier from Settings → API & MCP in Flow.',
  },
  [CODA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CODA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Coda',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste a Coda API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/coda',
    helpText:
      'Create a token under Account settings → API connections. A token restricted to specific docs or tables can only read and write those.',
  },
  [GAUGE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GAUGE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Gauge',
    tokenNoun: 'organization API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'gauge_sk_...',
        secret: true,
        hintPattern: /^gauge_sk_/,
        hintMessage: 'Gauge organization API keys start with gauge_sk_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/gauge',
    helpText:
      'Create a key in Gauge under Settings → Integrations → API Keys. Read only supports reports and reads; choose Read & write to manage prompts, topics, and tags. Reconnect with a new key after expiry or revocation.',
    invalidCredentialsHelp:
      'Use a Gauge organization API key, not a CLI login token. Check that the key has not expired or been revoked.',
  },
  [HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HIGGSFIELD_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Higgsfield',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'KEY_ID:KEY_SECRET',
        secret: true,
        hintPattern: /^[^:\s]+:[^:\s]+$/,
        hintMessage: 'Enter the key ID and secret joined by a colon: KEY_ID:KEY_SECRET.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/higgsfield',
    helpText:
      'Create an API key in the Higgsfield Console (console.higgsfield.ai). Paste its key ID and secret joined by a colon.',
    invalidCredentialsHelp:
      'Higgsfield rejected this key. Paste both parts as KEY_ID:KEY_SECRET and check that the key has not been disabled or deleted.',
  },
  [SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Snowflake',
    tokenNoun: 'programmatic access token',
    connectNoun: 'programmatic access token',
    fields: [
      {
        id: 'domain',
        label: 'Account host',
        placeholder: 'myorg-myaccount.snowflakecomputing.com',
        secret: false,
        hintPattern: SNOWFLAKE_HOST_HINT_REGEX,
        hintMessage: 'Snowflake account hosts end in .snowflakecomputing.com.',
      },
      {
        id: 'apiToken',
        label: 'Programmatic access token',
        placeholder: 'Paste a programmatic access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/snowflake-service-account',
    invalidCredentialsHelp:
      'Snowflake rejected this token. Check that it belongs to a user on this exact account host, that it has not expired or been revoked, that a network policy allows Sim to reach the account, and that the SQL API is enabled for the account.',
  },
  [TAVILY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TAVILY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Tavily',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'tvly-...',
        secret: true,
        hintPattern: /^tvly-/,
        hintMessage: 'Tavily API keys start with tvly-.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/tavily',
  },
  [AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AFFINITY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Affinity',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Affinity API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/affinity',
  },
  [AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AGENTMAIL_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'AgentMail',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your AgentMail API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/agentmail',
  },
  [AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AGENTPHONE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'AgentPhone',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your AgentPhone API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/agentphone',
  },
  [AHREFS_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AHREFS_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Ahrefs',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Ahrefs API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/ahrefs',
    helpText: 'The key needs access to the Ahrefs API v3 endpoints you plan to use.',
  },
  [APIFY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: APIFY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Apify',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Apify API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/apify',
    helpText: 'Find your API token in Apify Console under Settings, then API & Integrations.',
  },
  [APOLLO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: APOLLO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Apollo',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Apollo API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/apollo',
    helpText: 'Account, bulk, deal creation, and email account operations need a master API key.',
  },
  [BREX_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: BREX_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Brex',
    tokenNoun: 'user token',
    connectNoun: 'user token',
    fields: [
      {
        id: 'apiToken',
        label: 'User token',
        placeholder: 'Paste your Brex user token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/brex',
    helpText: 'The user token needs the Brex scopes for the data your workflows read or write.',
  },
  [BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: BRIGHTDATA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Bright Data',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Bright Data API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/brightdata',
  },
  [BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: BROWSER_USE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Browser Use',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [{ id: 'apiToken', label: 'API key', placeholder: 'bu_...', secret: true }],
    docsUrl: 'https://docs.sim.ai/integrations/browser_use',
  },
  [BUFFER_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: BUFFER_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Buffer',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Buffer API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/buffer',
  },
  [CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CIRCLEBACK_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Circleback',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'cb_...',
        secret: true,
        hintPattern: /^cb_/,
        hintMessage: 'Circleback API keys start with cb_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/circleback',
    helpText: 'Create an API key in Circleback under Settings, then API keys.',
  },
  [CLERK_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CLERK_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Clerk',
    tokenNoun: 'secret key',
    connectNoun: 'secret key',
    fields: [
      {
        id: 'apiToken',
        label: 'Secret key',
        placeholder: 'sk_live_...',
        secret: true,
        hintPattern: /^sk_(live|test)_/,
        hintMessage: 'Clerk secret keys start with sk_live_ or sk_test_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/clerk',
    helpText:
      'Copy the secret key from API keys in the Clerk Dashboard for the instance you want to manage.',
  },
  [CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CLOUDFLARE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Cloudflare',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Cloudflare API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/cloudflare',
    helpText:
      'Use a scoped API token, not the Global API Key. Grant it the permissions for the zones and accounts your workflows manage.',
  },
  [CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CRUNCHBASE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Crunchbase',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Crunchbase API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/crunchbase',
  },
  [DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DAYTONA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Daytona',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Daytona API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/daytona',
  },
  [ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ELEVENLABS_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'ElevenLabs',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your ElevenLabs API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/elevenlabs',
    helpText:
      'Restricted keys are accepted; give the key access to each endpoint your workflows call.',
    invalidCredentialsHelp:
      'ElevenLabs rejected this key. Check that it was copied in full and has not been deleted.',
  },
  [ENRICH_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ENRICH_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Enrich',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Enrich API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/enrich',
  },
  [GAMMA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GAMMA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Gamma',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'sk-gamma-...',
        secret: true,
        hintPattern: /^sk-gamma-/,
        hintMessage: 'Gamma API keys start with sk-gamma-.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/gamma',
    helpText: 'Create a key under Settings > API Keys in Gamma.',
  },
  [HEX_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HEX_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Hex',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'Paste your Hex API token', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/hex',
    helpText: 'Sim checks the token by listing projects, so it needs Read projects access.',
  },
  [HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HUGGINGFACE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Hugging Face',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste your Hugging Face access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/huggingface',
  },
  [INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: INCIDENTIO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'incident.io',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your incident.io API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/incidentio',
    helpText: 'Create a key in incident.io under Settings, API keys.',
  },
  [INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: INSTANTLY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Instantly',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Instantly API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/instantly',
    helpText: 'Scoped keys are accepted; give the key the scopes your workflows call.',
  },
  [LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LANGSMITH_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'LangSmith',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your LangSmith API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/langsmith',
  },
  [LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LAUNCHDARKLY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'LaunchDarkly',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste your LaunchDarkly access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/launchdarkly',
  },
  [LINQ_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LINQ_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Linq',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Linq API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/linq',
  },
  [LOOPS_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LOOPS_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Loops',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Loops API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/loops',
  },
  [LUMA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LUMA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Luma',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Luma API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/luma',
  },
  [MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MAILCHIMP_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Mailchimp',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'abc123...-us21',
        secret: true,
        hintPattern: /-[a-z]+[0-9]+$/,
        hintMessage: 'Mailchimp API keys end with your data center, like -us21.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/mailchimp',
    helpText: 'Use the full key, including the data center suffix after the dash.',
  },
  [OTTER_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: OTTER_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Otter.ai',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Otter.ai API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/otter',
    helpText: 'The Otter API is available on Enterprise workspaces only.',
  },
  [PERSONA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PERSONA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Persona',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Persona API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/persona',
    helpText: 'Grant the key the permissions your workflows need in Persona.',
  },
  [PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PROFOUND_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Profound',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Profound API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/profound',
  },
  [QUARTR_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: QUARTR_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Quartr',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Quartr API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/quartr',
  },
  [RB2B_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: RB2B_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'RB2B',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your RB2B API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/rb2b',
  },
  [RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: RIPPLING_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Rippling',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Rippling API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/rippling',
    helpText: 'Grant the token the scopes your workflows need.',
  },
  [ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ROCKETLANE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Rocketlane',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Rocketlane API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/rocketlane',
  },
  [SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SENDGRID_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'SendGrid',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your SendGrid API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/sendgrid',
    helpText:
      'Create a key in SendGrid under Settings > API Keys. A restricted key only works for the actions it is scoped to.',
  },
  [SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SIMILARWEB_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Similarweb',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Similarweb API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/similarweb',
  },
  [SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SIXTYFOUR_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Sixtyfour',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Sixtyfour API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/sixtyfour',
  },
  [SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SMARTLEAD_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Smartlead',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Smartlead API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/smartlead',
  },
  [SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SPORTMONKS_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Sportmonks',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Sportmonks API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/sportmonks',
  },
  [SQUARE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SQUARE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Square',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste your Square production access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/square',
    helpText:
      'Use a production access token from your app in the Square Developer Console; sandbox tokens are not supported.',
  },
  [TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TAILSCALE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Tailscale',
    tokenNoun: 'API access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'API access token',
        placeholder: 'Paste your Tailscale API access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/tailscale',
    helpText:
      "Generate an API access token in the Tailscale admin console under Settings > Keys. OAuth access tokens expire after an hour, so don't save one here.",
  },
  [TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TRIGGER_DEV_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Trigger.dev',
    tokenNoun: 'secret API key',
    connectNoun: 'secret key',
    fields: [
      {
        id: 'apiToken',
        label: 'Secret API key',
        placeholder: 'tr_prod_...',
        secret: true,
        hintPattern: /^tr_(dev|stg|prod|preview)_/,
        hintMessage:
          'Trigger.dev secret keys start with tr_dev_, tr_stg_, tr_prod_, or tr_preview_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/trigger_dev',
    helpText:
      'Each secret key belongs to one project environment; copy it from the API Keys page of that environment.',
  },
  [UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: UPTIMEROBOT_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'UptimeRobot',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your UptimeRobot API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/uptimerobot',
    helpText:
      "Use the main API key from Integrations > API in UptimeRobot; read-only keys can't make changes.",
  },
  [YOUCOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: YOUCOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'You.com',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your You.com API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/youcom',
  },
  [YOUTUBE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: YOUTUBE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'YouTube',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your YouTube Data API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/youtube',
    helpText: 'Create an API key in Google Cloud Console with the YouTube Data API v3 enabled.',
  },
  [MEM0_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MEM0_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Mem0',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Mem0 API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/mem0',
  },
  [ZEP_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ZEP_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Zep',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Zep project API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/zep',
  },
  [DISCORD_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DISCORD_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Discord',
    tokenNoun: 'bot token',
    connectNoun: 'bot token',
    fields: [
      {
        id: 'apiToken',
        label: 'Bot token',
        placeholder: 'Paste your Discord bot token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/discord',
    helpText:
      'Create a bot in the Discord Developer Portal and copy its token. The bot must be added to the servers your workflows use.',
  },
  [CURSOR_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CURSOR_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Cursor',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Cursor API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/cursor',
    helpText: 'Create an API key in the Cursor dashboard under API Keys.',
  },
  [DUB_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DUB_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Dub',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'dub_...',
        secret: true,
        hintPattern: /^dub_/,
        hintMessage: 'Dub API keys start with dub_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/dub',
  },
  [EXTEND_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: EXTEND_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Extend',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Extend API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/extend',
  },
  [FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: FIREFLIES_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Fireflies',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your Fireflies API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/fireflies',
  },
  [INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: INTERCOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Intercom',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste your Intercom access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/intercom',
    helpText: "Create it in the Intercom Developer Hub, on your app's Authentication page.",
  },
  [PULSE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PULSE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Pulse',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Pulse API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/pulse',
    helpText: 'Get your key from the Pulse Platform at platform.runpulse.com.',
  },
  [QUIVER_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: QUIVER_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Quiver',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste your QuiverAI API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/quiver',
  },
  [REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: REDUCTO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Reducto',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Reducto API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/reducto',
  },
  [FLINT_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: FLINT_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Flint',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [{ id: 'apiToken', label: 'API key', placeholder: 'ak_...', secret: true }],
    docsUrl: 'https://docs.sim.ai/integrations/flint',
    helpText: 'Create a key in your Flint team settings. It needs at least the member role.',
  },
  [ASHBY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ASHBY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Ashby',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Ashby API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/ashby',
    helpText:
      'Create an API key in Ashby under Admin > API Keys and grant read and write access to the modules your workflows use.',
    invalidCredentialsHelp:
      'Ashby rejected this key. Check that it was copied in full and has not been deactivated.',
  },
  [CALENDLY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CALENDLY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Calendly',
    tokenNoun: 'personal access token',
    connectNoun: 'personal access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Personal access token',
        placeholder: 'Paste your Calendly personal access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/calendly',
    helpText:
      'Create a personal access token in Calendly under Settings > Integrations > API & Webhooks.',
  },
  [CHECKR_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CHECKR_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Checkr',
    tokenNoun: 'secret API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'Secret API key',
        placeholder: 'Paste your Checkr secret API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/checkr',
    helpText:
      'Use a secret API key from your Checkr production account (Account Settings > Developer Settings). Staging keys do not work, since Sim calls api.checkr.com.',
    invalidCredentialsHelp:
      'Checkr rejected this key. Check that it is a production secret key, not a publishable or staging key.',
  },
  [FATHOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: FATHOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Fathom',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Fathom API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/fathom',
    helpText:
      'Create an API key in Fathom under User Settings > API Access. The key sees the meetings you recorded or that were shared with you or your team.',
  },
  [GRAIN_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GRAIN_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Grain',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste your Grain access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/grain',
    helpText:
      'Create a personal or workspace access token in Grain under Settings > Integrations > API. A personal token has the same access you have in Grain.',
  },
  [GRANOLA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GRANOLA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Granola',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Granola API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/granola',
    helpText:
      'Create an API key in the Granola desktop app under Settings > Connectors > API keys (Business or Enterprise plan). Workspace admins can create a workspace API key, which does not expire and reads public notes and spaces with API access enabled.',
  },
  [LEMLIST_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LEMLIST_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Lemlist',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Lemlist API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/lemlist',
    helpText: 'Find your API key in Lemlist under Settings > Integrations.',
    invalidCredentialsHelp:
      'Lemlist rejected the key. A key whose user is blocked also fails; generate a new key under Settings > Integrations.',
  },
  [PAGERDUTY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PAGERDUTY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'PagerDuty',
    tokenNoun: 'REST API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'REST API key',
        placeholder: 'Paste your PagerDuty REST API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/pagerduty',
    helpText:
      'Use an account REST API key (an administrator creates it under Integrations > API Access Keys) or a personal user API token (User Settings > API Access). Creating, updating, snoozing, merging, and noting incidents needs a full-access key; a read-only key covers the list and get operations.',
  },
  [RESEND_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: RESEND_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Resend',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 're_...',
        secret: true,
        hintPattern: /^re_/,
        hintMessage: 'Resend API keys start with re_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/resend',
    helpText:
      'A sending-access key can only send emails. Use a full-access key to manage contacts, audiences, broadcasts, and domains.',
    invalidCredentialsHelp:
      'Resend rejected this key. Check that it was copied in full and has not been deleted, deactivated, or suspended.',
  },
  [ROOTLY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ROOTLY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Rootly',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Rootly API key', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/rootly',
    helpText:
      'Use a Global or Team API key. A Personal key stops working if the person who created it leaves the organization.',
    invalidCredentialsHelp:
      'Rootly rejected this key. Check that it was copied in full and has not been revoked.',
  },
  [SENTRY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SENTRY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Sentry',
    tokenNoun: 'auth token',
    connectNoun: 'auth token',
    fields: [
      {
        id: 'apiToken',
        label: 'Auth token',
        placeholder: 'Paste your Sentry auth token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/sentry',
    helpText:
      'Use a user auth token or an internal integration token with the scopes your operations need, such as org:read, project:read, project:write, and event:read. The organization slug stays a field on the block.',
    invalidCredentialsHelp:
      'Sentry rejected this token. Check that it was copied in full, has not been revoked, and belongs to sentry.io rather than a self-hosted Sentry.',
  },
  [STRIPE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: STRIPE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Stripe',
    tokenNoun: 'secret key',
    connectNoun: 'secret key',
    fields: [
      {
        id: 'apiToken',
        label: 'Secret key',
        placeholder: 'sk_live_...',
        secret: true,
        hintPattern: /^(sk|rk)_(live|test)_/,
        hintMessage:
          'Stripe secret keys start with sk_live_ or sk_test_ (restricted keys with rk_).',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/stripe',
    helpText:
      'Create a secret or restricted key under Developers > API keys in the Stripe Dashboard. A restricted key needs read or write access to the resources your workflows use.',
  },
  [TELEGRAM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TELEGRAM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Telegram',
    tokenNoun: 'bot token',
    connectNoun: 'bot token',
    fields: [
      {
        id: 'apiToken',
        label: 'Bot token',
        placeholder: '123456789:ABC...',
        secret: true,
        hintPattern: /^\d+:/,
        hintMessage: 'Telegram bot tokens look like 123456789:ABC-DEF...',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/telegram',
    helpText:
      'Message /newbot to @BotFather in Telegram to create a bot and copy the token it gives you.',
  },
  [TYPEFORM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TYPEFORM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Typeform',
    tokenNoun: 'personal access token',
    connectNoun: 'personal access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Personal access token',
        placeholder: 'Paste personal access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/typeform',
    helpText:
      'Create a personal access token in Typeform under Account > Personal tokens. Grant the forms and responses scopes your workflows use.',
    invalidCredentialsHelp:
      'Typeform rejected this token. Check that it has not been revoked and that it includes the forms:read scope.',
  },
  [VERCEL_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: VERCEL_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Vercel',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      { id: 'apiToken', label: 'Access token', placeholder: 'Paste access token', secret: true },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/vercel',
    helpText:
      'Create a token under Account Settings > Tokens in the Vercel dashboard, scoped to the team your workflows manage.',
  },
  [WHATSAPP_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: WHATSAPP_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'WhatsApp',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste WhatsApp Cloud API access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/whatsapp',
    helpText:
      'Use a permanent system user access token from Meta Business Settings with the whatsapp_business_messaging permission. Temporary tokens from the App Dashboard expire after 24 hours.',
    invalidCredentialsHelp:
      'Meta rejected this token. Check that it has not expired or been revoked; temporary App Dashboard tokens last only 24 hours.',
  },
  [GITLAB_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GITLAB_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'GitLab',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      { id: 'apiToken', label: 'Access token', placeholder: 'glpat-...', secret: true },
      { id: 'domain', label: 'GitLab host', placeholder: 'gitlab.com', secret: false },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/gitlab',
    helpText:
      'Use a personal, project, or group access token with the api scope (read_api for read-only workflows). Enter gitlab.com, or your self-managed host.',
    invalidCredentialsHelp:
      'GitLab rejected this token. Check that it is active, has the api or read_api scope, and belongs to the host you entered.',
  },
  [GITHUB_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GITHUB_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'GitHub',
    tokenNoun: 'personal access token',
    connectNoun: 'personal access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Personal access token',
        placeholder: 'github_pat_... or ghp_...',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/github',
    helpText:
      'Use a fine-grained personal access token limited to the repositories the workflow needs, or a classic token with the repo scope. GitHub Enterprise Server hosts are not supported.',
    invalidCredentialsHelp:
      'GitHub rejected this token. Check that it has not expired or been revoked, and that it is a personal access token for github.com rather than a GitHub App or Enterprise Server token.',
  },
  [BITBUCKET_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: BITBUCKET_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Bitbucket',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste an access token or a Bitbucket API token',
        secret: true,
      },
      {
        id: 'providerWorkspaceId',
        label: 'Repository',
        placeholder: 'my-workspace/my-repository',
        secret: false,
        hintPattern: /^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/,
        hintMessage:
          'Enter a repository the token can read as workspace/repository, as in bitbucket.org/my-workspace/my-repository.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/bitbucket-service-account',
    helpText:
      'Use a Bitbucket Cloud workspace, project, or repository access token with at least the repository scope, or an Atlassian API token created for Bitbucket with at least repository read (app passwords no longer work). Enter any repository the token can read, as workspace/repository; Sim reads it once to verify the token.',
    invalidCredentialsHelp:
      'Bitbucket rejected this token. Check that it has not expired or been revoked, has repository read access, and can read the repository you entered. App passwords no longer work; use an access token or an API token created for Bitbucket.',
  },
  [GRAFANA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GRAFANA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Grafana',
    tokenNoun: 'service account token',
    connectNoun: 'service account token',
    fields: [
      { id: 'apiToken', label: 'Service account token', placeholder: 'glsa_...', secret: true },
      {
        id: 'domain',
        label: 'Grafana URL',
        placeholder: 'https://your-stack.grafana.net',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/grafana',
    helpText:
      'Create a service account and token in Grafana under Administration > Users and access > Service accounts. Give the service account a role that covers what your workflows change (Editor for dashboards and annotations, Admin for alerting and folders). Enter your Grafana Cloud stack URL or your self-managed instance URL.',
    invalidCredentialsHelp:
      'Grafana rejected this token. Check that it has not expired or been revoked, and that it belongs to the instance you entered.',
  },
  [JUPYTER_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: JUPYTER_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Jupyter',
    tokenNoun: 'server token',
    connectNoun: 'server token',
    fields: [
      {
        id: 'apiToken',
        label: 'Token',
        placeholder: 'Paste your Jupyter server token',
        secret: true,
      },
      {
        id: 'domain',
        label: 'Server URL',
        placeholder: 'https://jupyter.example.com',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/jupyter',
    helpText:
      "Use the token your Jupyter server prints at startup (or the API token from JupyterHub under Token). Enter the server's base URL, including any path prefix such as /user/<name> on JupyterHub. The server must be reachable from Sim.",
    invalidCredentialsHelp:
      'The Jupyter server rejected this token. Check that it matches the server you entered and that the server is still running.',
  },
  [CONVEX_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CONVEX_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Convex',
    tokenNoun: 'deploy key',
    connectNoun: 'deploy key',
    fields: [
      {
        id: 'apiToken',
        label: 'Deploy key',
        placeholder: 'prod:your-deployment|...',
        secret: true,
      },
      {
        id: 'domain',
        label: 'Deployment URL',
        placeholder: 'https://your-deployment.convex.cloud',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/convex',
    helpText:
      'Generate a deploy key for the deployment in the Convex dashboard under Settings > General, and copy the deployment URL from the same page. Listing tables and exporting documents need a key with permission to read data.',
    invalidCredentialsHelp:
      'Convex rejected this key. Check that it was generated for the deployment URL you entered and has not been revoked.',
  },
  [TINYBIRD_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TINYBIRD_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Tinybird',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'p.eyJ...', secret: true },
      {
        id: 'domain',
        label: 'API base URL',
        placeholder: 'https://api.tinybird.co',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/tinybird',
    helpText:
      "Copy a token from Tokens in your Tinybird workspace. Enter the API base URL for your workspace's region (for example https://api.us-east.aws.tinybird.co), or your self-managed URL. Give the token the scopes your workflows need, such as DATASOURCES:APPEND or PIPES:READ.",
    invalidCredentialsHelp:
      'Tinybird rejected this token. Check that it was copied in full and that the base URL is the region your workspace lives in; a token only works in its own region.',
  },
  [DYNATRACE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DYNATRACE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Dynatrace',
    tokenNoun: 'access token',
    connectNoun: 'access token',
    fields: [
      { id: 'apiToken', label: 'Access token', placeholder: 'dt0c01...', secret: true },
      {
        id: 'domain',
        label: 'Environment URL',
        placeholder: 'https://abc12345.live.dynatrace.com',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/dynatrace',
    helpText:
      'Generate an access token in Dynatrace under Access tokens with the scopes your workflows use (for example problems.read, metrics.read, logs.read). Enter your environment URL, such as https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/<environment-id> for Managed.',
    invalidCredentialsHelp:
      'Dynatrace rejected this token. Check that it is enabled, has not expired, and was created in the environment at this URL.',
  },
  [NEW_RELIC_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: NEW_RELIC_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'New Relic',
    tokenNoun: 'User API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'User API key', placeholder: 'NRAK-...', secret: true },
      { id: 'domain', label: 'Region', placeholder: 'us or eu', secret: false },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/new_relic',
    helpText:
      'Create a User API key (NRAK-...) in New Relic under API keys. Enter us, or eu if your account is in the EU data center.',
    invalidCredentialsHelp:
      "New Relic rejected this key. Check that it is a User API key (NRAK-...), not a license or browser key, and that the region matches your account's data center.",
  },
  [LOGFIRE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LOGFIRE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Logfire',
    tokenNoun: 'read token',
    connectNoun: 'read token',
    fields: [
      { id: 'apiToken', label: 'Read token', placeholder: 'pylf_v1_us_...', secret: true },
      {
        id: 'domain',
        label: 'Region or host',
        placeholder: 'auto, us, eu, or https://logfire.example.com',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/logfire',
    helpText:
      'Create a read token in your Logfire project under Settings > Read tokens. Enter auto to use the region in the token, us or eu to choose a Logfire Cloud region, or the base URL of a self-hosted instance.',
    invalidCredentialsHelp:
      'Logfire rejected this read token. Check that it is a read token (not a write token), has not expired, and belongs to the region or host you entered.',
  },
  [MAILGUN_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MAILGUN_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Mailgun',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste Mailgun API key', secret: true },
      {
        id: 'domain',
        label: 'Region',
        placeholder: 'us or eu',
        secret: false,
        hintPattern: /^(us|eu|US|EU)$/,
        hintMessage: 'Enter us or eu, the region your Mailgun account is hosted in.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/mailgun',
    helpText:
      'Use an account API key from API Security in Mailgun, and the region (us or eu) your account is hosted in. Domain sending keys only send mail and cannot be saved here.',
    invalidCredentialsHelp:
      'Mailgun rejected this key. Check that it is an account API key, not a domain sending key, and that the region matches the one your account is hosted in.',
  },
  [JOTFORM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: JOTFORM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Jotform',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste Jotform API key', secret: true },
      {
        id: 'domain',
        label: 'Region',
        placeholder: 'us, eu, or hipaa',
        secret: false,
        hintPattern: /^(us|eu|hipaa|US|EU|HIPAA)$/,
        hintMessage: 'Enter us, eu, or hipaa, the region your Jotform account is hosted in.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/jotform',
    helpText:
      'Create a key under Account Settings → API. Use eu for EU Safe accounts and hipaa for HIPAA accounts. A Read Access key validates here and then fails on actions that write.',
    invalidCredentialsHelp:
      'Jotform rejected this key. Check that it is still enabled and that the region matches your account: a key only works on the host that issued it.',
  },
  [PLANE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PLANE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Plane',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'plane_api_...', secret: true },
      {
        id: 'domain',
        label: 'Instance URL',
        placeholder: 'https://api.plane.so',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/plane',
    helpText:
      'Create a token under Profile settings → API tokens. Enter https://api.plane.so for Plane Cloud, or your self-hosted instance URL including any reverse-proxy path, without /api/v1.',
    invalidCredentialsHelp:
      'Plane rejected this token. Check that it is active and was created on the instance URL you entered.',
  },
  [AZURE_DEVOPS_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AZURE_DEVOPS_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Azure DevOps',
    tokenNoun: 'personal access token',
    connectNoun: 'personal access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Personal access token',
        placeholder: 'Paste your Azure DevOps personal access token',
        secret: true,
      },
      {
        id: 'providerWorkspaceId',
        label: 'Organization',
        placeholder: 'contoso',
        secret: false,
        hintPattern: /^[A-Za-z0-9][A-Za-z0-9-]*$/,
        hintMessage: 'Enter the organization name only, as in dev.azure.com/contoso.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/azure_devops',
    helpText:
      'Create a personal access token in Azure DevOps under User settings > Personal access tokens, scoped to this organization with Build: Read and Work Items: Read & write. Enter the organization name from dev.azure.com/<organization>.',
    invalidCredentialsHelp:
      'Azure DevOps rejected this token. Check that it has not expired or been revoked, and that it was created for the organization you entered.',
  },
  [TWILIO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TWILIO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Twilio',
    tokenNoun: 'auth token',
    connectNoun: 'auth token',
    fields: [
      {
        id: 'apiToken',
        label: 'Auth token or API key',
        placeholder: 'Paste your auth token, or SKxxx:secret for an API key',
        secret: true,
        hintPattern: /^(?!SK)|^SK[0-9a-fA-F]{32}:\S+$/,
        hintMessage: 'Enter an API key as its SID and secret joined by a colon: SKxxx:secret.',
      },
      {
        id: 'providerWorkspaceId',
        label: 'Account SID',
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: false,
        hintPattern: /^AC[0-9a-f]{32}$/,
        hintMessage: 'Twilio Account SIDs start with AC followed by 32 characters.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/twilio_sms',
    helpText:
      'Copy the Account SID and Auth Token from Account Info on your Twilio Console dashboard. To use an API key instead, enter its SID and secret joined by a colon (SKxxx:secret); a Standard or Main key works, and a restricted key needs read access to phone numbers.',
    invalidCredentialsHelp:
      'Twilio rejected this Account SID and auth token or API key. Check that the token or key belongs to this account and has not been rotated or deleted, and that an API key is entered as SKxxx:secret.',
  },
  [ALGOLIA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ALGOLIA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Algolia',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Algolia API key', secret: true },
      {
        id: 'providerWorkspaceId',
        label: 'Application ID',
        placeholder: 'e.g. ABCD1234EF',
        secret: false,
        hintPattern: /^[A-Za-z0-9]+$/,
        hintMessage: 'Algolia application IDs contain only letters and numbers.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/algolia',
    helpText:
      'Copy the Application ID and an API key from Settings > API Keys in the Algolia dashboard. Use the Write API key, or a key with the ACLs your workflows need; a Search-only key can only search, and secured (derived) keys are not supported.',
    invalidCredentialsHelp:
      'Algolia rejected this application ID and API key. Check that the key belongs to this application and has not been deleted.',
  },
  [UPSTASH_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: UPSTASH_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Upstash',
    tokenNoun: 'REST token',
    connectNoun: 'REST token',
    fields: [
      {
        id: 'apiToken',
        label: 'REST token',
        placeholder: 'Paste your Upstash Redis REST token',
        secret: true,
      },
      {
        id: 'domain',
        label: 'REST URL',
        placeholder: 'https://your-database.upstash.io',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/upstash',
    helpText:
      'Copy the REST URL and token from the REST API section of your database in the Upstash console. A read-only token works for read operations only.',
    invalidCredentialsHelp:
      'Upstash rejected this REST token. Check that it belongs to the database at this URL and was not reset.',
  },
  [EMAILBISON_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: EMAILBISON_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Email Bison',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Email Bison API token',
        secret: true,
      },
      {
        id: 'domain',
        label: 'Instance URL',
        placeholder: 'https://dedi.emailbison.com',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/emailbison',
    helpText:
      'Create an API token in Email Bison under Settings > Developer API. Enter the URL you sign in to Email Bison at; a workspace token only works for the workspace it was created in.',
    invalidCredentialsHelp:
      'Email Bison rejected this token. Check that it was copied in full and that the instance URL is the one where the token was created.',
  },
  [DEVIN_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DEVIN_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Devin',
    tokenNoun: 'service user API key',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'cog_...',
        secret: true,
        hintPattern: /^cog_/,
        hintMessage: 'Devin service user keys start with cog_.',
      },
      {
        id: 'providerWorkspaceId',
        label: 'Organization ID',
        placeholder: 'org-...',
        secret: false,
        hintPattern: /^org-/,
        hintMessage: 'Devin organization IDs start with org-.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/devin',
    helpText:
      'Create a service user in Devin under Settings > Service Users with permission to manage sessions, and copy its API key and your organization ID.',
    invalidCredentialsHelp:
      'Devin rejected this key for that organization. Check that the key belongs to a service user in this organization and can view sessions.',
  },
  [OKTA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: OKTA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Okta',
    tokenNoun: 'API token',
    connectNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste your Okta API token',
        secret: true,
      },
      { id: 'domain', label: 'Okta domain', placeholder: 'dev-123456.okta.com', secret: false },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/okta',
    helpText:
      'Create an API token in the Okta Admin Console under Security > API > Tokens. The token acts with the admin roles of the user who created it. Enter your Okta domain, such as dev-123456.okta.com; custom domains are not supported.',
    invalidCredentialsHelp:
      'Okta rejected this token. Check that it is active, was created in this Okta org, and that the domain is your Okta-hosted domain (okta.com, oktapreview.com, okta-emea.com, okta-gov.com, or trexcloud.com).',
  },
  [INFISICAL_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: INFISICAL_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Infisical',
    tokenNoun: 'machine identity access token',
    connectNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste a machine identity access token',
        secret: true,
      },
      {
        id: 'domain',
        label: 'Instance URL',
        placeholder: 'https://us.infisical.com',
        secret: false,
        url: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/infisical',
    helpText:
      'Use https://us.infisical.com for US Cloud, https://eu.infisical.com for EU Cloud, or your self-hosted URL. Sim does not renew the token, so it stops working when its Access Token TTL runs out: set a long Access Token TTL and Max TTL on the identity, and leave Access Token Period unset, since a periodic token expires unless it is renewed.',
    invalidCredentialsHelp:
      'Paste a machine identity access token, not a client secret or service token, and make sure the instance URL matches the region the identity lives in.',
  },
  [SUPABASE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SUPABASE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Supabase',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your project API key', secret: true },
      { id: 'domain', label: 'Project ID', placeholder: 'abcdefghijklmnopqrst', secret: false },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/supabase',
    helpText:
      'Use a key from Project Settings > API Keys. A secret or service_role key bypasses row-level security; an anon or publishable key is limited by your policies.',
    invalidCredentialsHelp:
      "Supabase rejected this key. Check that it belongs to the project you entered and hasn't been revoked.",
  },
  [THRIVE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: THRIVE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Thrive',
    tokenNoun: 'API key',
    connectNoun: 'API key',
    fields: [
      { id: 'apiToken', label: 'API key', placeholder: 'Paste your Thrive API key', secret: true },
      {
        id: 'providerWorkspaceId',
        label: 'Tenant ID',
        placeholder: 'Your Thrive tenant ID',
        secret: false,
      },
      { id: 'domain', label: 'Region host', placeholder: 'public.api.learn.link', secret: false },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/thrive',
    helpText:
      'Use the API key and tenant ID from your Thrive admin settings. Region host is public.api.learn.link, or public.api.mea.learn.tech for the Middle East and Africa (staging hosts also work).',
    invalidCredentialsHelp:
      'Thrive rejected this API key. Check that the tenant ID matches the key and that the region host is the one your tenant uses.',
  },
  [PLANETSCALE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: PLANETSCALE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'PlanetScale',
    tokenNoun: 'service token',
    connectNoun: 'service token',
    fields: [
      {
        id: 'apiToken',
        label: 'Service token',
        placeholder: 'Paste your PlanetScale service token',
        secret: true,
      },
      {
        id: 'providerWorkspaceId',
        label: 'Service token ID',
        placeholder: 'Paste the service token ID',
        secret: false,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/planetscale',
    helpText:
      "Create a service token on your PlanetScale organization's Service tokens page, copy its ID and token, and grant it access to the organization and databases your workflows use.",
    invalidCredentialsHelp:
      'PlanetScale rejected this service token. Check that the token ID and token belong together and that the token has not been deleted or expired.',
  },
  [GONG_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GONG_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Gong',
    tokenNoun: 'access key secret',
    connectNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'Access key secret',
        placeholder: 'Paste your Gong access key secret',
        secret: true,
      },
      {
        id: 'providerWorkspaceId',
        label: 'Access key',
        placeholder: 'Paste your Gong access key',
        secret: false,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/gong',
    helpText:
      'A Gong technical administrator creates the access key and secret on the API page of the Gong company settings. Sim calls https://api.gong.io; an account whose API page shows a different base URL is not supported yet.',
    invalidCredentialsHelp:
      'Gong rejected this access key and secret. Check that they were created together, have not been revoked, and that your Gong plan includes API access. If the API page in Gong shows a base URL other than https://api.gong.io, that account is not supported yet.',
  },
  [SERVICENOW_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SERVICENOW_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'ServiceNow',
    tokenNoun: 'password',
    connectNoun: 'login',
    fields: [
      {
        id: 'apiToken',
        label: 'Password',
        placeholder: 'Enter the ServiceNow user password',
        secret: true,
        preserveWhitespace: true,
      },
      {
        id: 'providerWorkspaceId',
        label: 'Username',
        placeholder: 'Enter the ServiceNow username',
        secret: false,
      },
      {
        id: 'domain',
        label: 'Instance URL',
        placeholder: 'yourcompany.service-now.com',
        secret: false,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/servicenow',
    helpText:
      "Use a dedicated integration user with the roles your workflows need and without multi-factor authentication. Enter your instance's https URL, like acme.service-now.com or a custom instance URL. The instance must be reachable from the internet.",
    invalidCredentialsHelp:
      'ServiceNow rejected this username and password. Check the instance URL, and that the user is active, not locked out, and not required to use multi-factor authentication.',
  },
}

/**
 * Required contract fields per token provider in client-credentials mode: the client ID and
 * secret replace the token, and every other descriptor field (a store domain) stays required.
 */
export const TOKEN_SERVICE_ACCOUNT_CLIENT_CREDENTIAL_FIELDS: Record<
  string,
  ReadonlyArray<'clientId' | 'clientSecret' | Exclude<TokenServiceAccountFieldId, 'apiToken'>>
> = Object.fromEntries(
  Object.values(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS)
    .filter((descriptor) => descriptor.clientCredentials)
    .map((descriptor) => [
      descriptor.providerId,
      [
        'clientId',
        'clientSecret',
        ...descriptor.fields.flatMap((field) => (field.id === 'apiToken' ? [] : [field.id])),
      ],
    ])
)

/**
 * Required contract fields per token service-account provider, consumed by the
 * `createCredentialBodySchema` superRefine so validation errors name the exact
 * missing field. Derived from each descriptor's field list.
 */
export const TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS: Record<string, TokenServiceAccountFieldId[]> =
  Object.fromEntries(
    Object.values(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS).map((descriptor) => [
      descriptor.providerId,
      descriptor.fields.map((field) => field.id),
    ])
  )

export function isTokenServiceAccountProviderId(
  value: string | null | undefined
): value is TokenServiceAccountProviderId {
  return Boolean(value && Object.hasOwn(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS, value))
}

export function getTokenServiceAccountDescriptor(
  providerId: string | null | undefined
): TokenServiceAccountDescriptor | undefined {
  return isTokenServiceAccountProviderId(providerId)
    ? TOKEN_SERVICE_ACCOUNT_DESCRIPTORS[providerId]
    : undefined
}

/**
 * Maps a credential-verification `error.code` to a user-facing message for a
 * given provider. Provider-specific copy is inherited from the descriptor
 * (token noun, service label, and the optional `invalidCredentialsHelp`
 * override) rather than hard-coded in the shared connect modal. An
 * unknown/absent code uses the caller's fallback or a generic retry message.
 */
export function getTokenServiceAccountErrorMessage(
  descriptor: TokenServiceAccountDescriptor,
  code: string | undefined,
  fallbackMessage = "We couldn't add this credential. Try again in a moment.",
  authMethod?: string
): string {
  const clientCredentials =
    authMethod === CLIENT_CREDENTIALS_AUTH_METHOD ? descriptor.clientCredentials : undefined
  switch (code) {
    case 'invalid_credentials':
      return (
        clientCredentials?.invalidCredentialsHelp ??
        descriptor.invalidCredentialsHelp ??
        `We couldn't authenticate with that ${descriptor.tokenNoun}. Double-check it in ${descriptor.serviceLabel} and try again.`
      )
    case 'grant_not_permitted':
      return (
        clientCredentials?.notPermittedHelp ??
        `${descriptor.serviceLabel} does not allow these client credentials for this account.`
      )
    case 'site_not_found':
      return "We couldn't find an account at that domain. Check the spelling and try again."
    case 'host_not_allowed':
      return "Sim can't connect to that address. Use the service's public https URL."
    case 'provider_unavailable':
      return `We couldn't reach ${descriptor.serviceLabel} to verify these credentials. Try again in a moment.`
    case 'duplicate_display_name':
      return 'A credential with that name already exists in this workspace.'
    default:
      return fallbackMessage
  }
}
