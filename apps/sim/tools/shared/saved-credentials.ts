import type { OAuthService } from '@/lib/oauth'
import type { SubBlockConfig } from '@/blocks/types'
import type { CredentialParamSource, OAuthConfig } from '@/tools/types'

/**
 * Credential policy for every AWS tool. `required: false` keeps the inline
 * access-key params working unchanged; when a saved AWS credential is selected
 * instead, the executor authorizes it and the operation resolves it to session
 * credentials server-side.
 */
export const AWS_CREDENTIAL_OAUTH = {
  required: false,
  provider: 'aws',
  credentialKind: 'service-account',
  /** Both key-param spellings AWS tools use. */
  credentialSuppliedParams: [
    'accessKeyId',
    'secretAccessKey',
    'awsAccessKeyId',
    'awsSecretAccessKey',
  ],
} as const satisfies OAuthConfig

/**
 * AWS tools that sign their own HTTP request rather than running through an
 * AWS operation family; the executor hands them the resolved session keys and
 * token directly. Any other AWS tool must run through a wrapped family.
 */
export const AWS_SESSION_SIGNED_TOOL_IDS: ReadonlySet<string> = new Set(['s3_get_object'])

/**
 * Saved-credential providers whose tools resolve the credential inside their
 * own operation (AWS mints session keys per call) rather than through
 * `credentialParams`.
 */
export const OPERATION_RESOLVED_CREDENTIAL_PROVIDERS: ReadonlySet<string> = new Set([
  AWS_CREDENTIAL_OAUTH.provider,
])

/**
 * Credential policy for a tool that takes an inline token and also accepts a
 * saved token credential. `credentialParams` maps each inline param to the
 * credential field that fills it server-side; the same keys are the params
 * the credential supplies, so the two can never drift apart. Mapped params are
 * always overwritten, so a bound host can never be steered by the caller.
 */
export function tokenCredentialOAuth(
  provider: OAuthService,
  credentialParams: Readonly<Record<string, CredentialParamSource>>
) {
  return {
    required: false,
    provider,
    credentialKind: 'service-account',
    credentialParams,
    credentialSuppliedParams: Object.keys(credentialParams),
  } as const satisfies OAuthConfig
}

/** Whether a subblock is the saved-credential picker `withSavedCredential` inserts. */
export function isSavedCredentialPicker(
  subBlock: Pick<SubBlockConfig, 'type' | 'credentialKind' | 'canonicalParamId'>
): boolean {
  return (
    subBlock.type === 'oauth-input' &&
    subBlock.credentialKind === 'service-account' &&
    subBlock.canonicalParamId === 'oauthCredential'
  )
}

/**
 * The tool params a block's saved-credential picker supplies: the tool's
 * `credentialSuppliedParams` when the block has a picker feeding
 * `oauthCredential`, otherwise none. The single rule serializer validation,
 * the block-registry checks, and agent tool-input fields all apply, so a
 * credential-only block never asks for — and a legacy block never stops asking
 * for — an inline secret.
 */
export function credentialSuppliedParamsFor(
  oauth: Pick<OAuthConfig, 'credentialSuppliedParams'> | undefined,
  subBlocks: readonly Pick<SubBlockConfig, 'canonicalParamId' | 'type'>[]
): ReadonlySet<string> {
  const hasPicker = subBlocks.some(
    (subBlock) => subBlock.type === 'oauth-input' && subBlock.canonicalParamId === 'oauthCredential'
  )
  return new Set(hasPicker ? oauth?.credentialSuppliedParams : [])
}

/**
 * Credential policy for every Databricks tool. A saved Databricks connection
 * resolves to a bearer token and its workspace host, which fill the tools'
 * inline `apiKey` and `host` — so the host always comes from the connection.
 */
export const DATABRICKS_CREDENTIAL_OAUTH = tokenCredentialOAuth('databricks', {
  apiKey: 'accessToken',
  host: 'domain',
})

/** Token credential policies for tools that take an inline key or a saved token credential. */
export const AFFINITY_CREDENTIAL_OAUTH = tokenCredentialOAuth('affinity', { apiKey: 'accessToken' })
export const AGENTMAIL_CREDENTIAL_OAUTH = tokenCredentialOAuth('agentmail', {
  apiKey: 'accessToken',
})
export const AGENTPHONE_CREDENTIAL_OAUTH = tokenCredentialOAuth('agentphone', {
  apiKey: 'accessToken',
})
export const AHREFS_CREDENTIAL_OAUTH = tokenCredentialOAuth('ahrefs', { apiKey: 'accessToken' })
export const APIFY_CREDENTIAL_OAUTH = tokenCredentialOAuth('apify', { apiKey: 'accessToken' })
export const APOLLO_CREDENTIAL_OAUTH = tokenCredentialOAuth('apollo', { apiKey: 'accessToken' })
export const ASHBY_CREDENTIAL_OAUTH = tokenCredentialOAuth('ashby', { apiKey: 'accessToken' })
export const BREX_CREDENTIAL_OAUTH = tokenCredentialOAuth('brex', { apiKey: 'accessToken' })
export const BRIGHTDATA_CREDENTIAL_OAUTH = tokenCredentialOAuth('brightdata', {
  apiKey: 'accessToken',
})
export const BROWSER_USE_CREDENTIAL_OAUTH = tokenCredentialOAuth('browser_use', {
  apiKey: 'accessToken',
})
export const BUFFER_CREDENTIAL_OAUTH = tokenCredentialOAuth('buffer', { apiKey: 'accessToken' })
export const CALENDLY_CREDENTIAL_OAUTH = tokenCredentialOAuth('calendly', { apiKey: 'accessToken' })
export const CHECKR_CREDENTIAL_OAUTH = tokenCredentialOAuth('checkr', { apiKey: 'accessToken' })
export const CIRCLEBACK_CREDENTIAL_OAUTH = tokenCredentialOAuth('circleback', {
  apiKey: 'accessToken',
})
export const CLERK_CREDENTIAL_OAUTH = tokenCredentialOAuth('clerk', { secretKey: 'accessToken' })
export const CLOUDFLARE_CREDENTIAL_OAUTH = tokenCredentialOAuth('cloudflare', {
  apiKey: 'accessToken',
})
export const CRUNCHBASE_CREDENTIAL_OAUTH = tokenCredentialOAuth('crunchbase', {
  apiKey: 'accessToken',
})
export const CURSOR_CREDENTIAL_OAUTH = tokenCredentialOAuth('cursor', { apiKey: 'accessToken' })
export const DAYTONA_CREDENTIAL_OAUTH = tokenCredentialOAuth('daytona', { apiKey: 'accessToken' })
export const DISCORD_CREDENTIAL_OAUTH = tokenCredentialOAuth('discord', { botToken: 'accessToken' })
export const DUB_CREDENTIAL_OAUTH = tokenCredentialOAuth('dub', { apiKey: 'accessToken' })
export const ELEVENLABS_CREDENTIAL_OAUTH = tokenCredentialOAuth('elevenlabs', {
  apiKey: 'accessToken',
})
export const ENRICH_CREDENTIAL_OAUTH = tokenCredentialOAuth('enrich', { apiKey: 'accessToken' })
export const EXTEND_CREDENTIAL_OAUTH = tokenCredentialOAuth('extend', { apiKey: 'accessToken' })
export const FATHOM_CREDENTIAL_OAUTH = tokenCredentialOAuth('fathom', { apiKey: 'accessToken' })
export const FIREFLIES_CREDENTIAL_OAUTH = tokenCredentialOAuth('fireflies', {
  apiKey: 'accessToken',
})
export const FLINT_CREDENTIAL_OAUTH = tokenCredentialOAuth('flint', { apiKey: 'accessToken' })
export const GAMMA_CREDENTIAL_OAUTH = tokenCredentialOAuth('gamma', { apiKey: 'accessToken' })
export const GRAIN_CREDENTIAL_OAUTH = tokenCredentialOAuth('grain', { apiKey: 'accessToken' })
export const GRANOLA_CREDENTIAL_OAUTH = tokenCredentialOAuth('granola', { apiKey: 'accessToken' })
export const HEX_CREDENTIAL_OAUTH = tokenCredentialOAuth('hex', { apiKey: 'accessToken' })
export const HUGGINGFACE_CREDENTIAL_OAUTH = tokenCredentialOAuth('huggingface', {
  apiKey: 'accessToken',
})
export const INCIDENTIO_CREDENTIAL_OAUTH = tokenCredentialOAuth('incidentio', {
  apiKey: 'accessToken',
})
export const INSTANTLY_CREDENTIAL_OAUTH = tokenCredentialOAuth('instantly', {
  apiKey: 'accessToken',
})
export const INTERCOM_CREDENTIAL_OAUTH = tokenCredentialOAuth('intercom', {
  accessToken: 'accessToken',
})
export const LANGSMITH_CREDENTIAL_OAUTH = tokenCredentialOAuth('langsmith', {
  apiKey: 'accessToken',
})
export const LAUNCHDARKLY_CREDENTIAL_OAUTH = tokenCredentialOAuth('launchdarkly', {
  apiKey: 'accessToken',
})
export const LEMLIST_CREDENTIAL_OAUTH = tokenCredentialOAuth('lemlist', { apiKey: 'accessToken' })
export const LINQ_CREDENTIAL_OAUTH = tokenCredentialOAuth('linq', { apiKey: 'accessToken' })
export const LOOPS_CREDENTIAL_OAUTH = tokenCredentialOAuth('loops', { apiKey: 'accessToken' })
export const LUMA_CREDENTIAL_OAUTH = tokenCredentialOAuth('luma', { apiKey: 'accessToken' })
export const MAILCHIMP_CREDENTIAL_OAUTH = tokenCredentialOAuth('mailchimp', {
  apiKey: 'accessToken',
})
export const MEM0_CREDENTIAL_OAUTH = tokenCredentialOAuth('mem0', { apiKey: 'accessToken' })
export const OTTER_CREDENTIAL_OAUTH = tokenCredentialOAuth('otter', { apiKey: 'accessToken' })
export const PAGERDUTY_CREDENTIAL_OAUTH = tokenCredentialOAuth('pagerduty', {
  apiKey: 'accessToken',
})
export const PERSONA_CREDENTIAL_OAUTH = tokenCredentialOAuth('persona', { apiKey: 'accessToken' })
export const PROFOUND_CREDENTIAL_OAUTH = tokenCredentialOAuth('profound', { apiKey: 'accessToken' })
export const PULSE_CREDENTIAL_OAUTH = tokenCredentialOAuth('pulse', { apiKey: 'accessToken' })
export const QUARTR_CREDENTIAL_OAUTH = tokenCredentialOAuth('quartr', { apiKey: 'accessToken' })
export const QUIVER_CREDENTIAL_OAUTH = tokenCredentialOAuth('quiver', { apiKey: 'accessToken' })
export const RB2B_CREDENTIAL_OAUTH = tokenCredentialOAuth('rb2b', { apiKey: 'accessToken' })
export const REDUCTO_CREDENTIAL_OAUTH = tokenCredentialOAuth('reducto', { apiKey: 'accessToken' })
export const RESEND_CREDENTIAL_OAUTH = tokenCredentialOAuth('resend', {
  resendApiKey: 'accessToken',
})
export const RIPPLING_CREDENTIAL_OAUTH = tokenCredentialOAuth('rippling', { apiKey: 'accessToken' })
export const ROCKETLANE_CREDENTIAL_OAUTH = tokenCredentialOAuth('rocketlane', {
  apiKey: 'accessToken',
})
export const ROOTLY_CREDENTIAL_OAUTH = tokenCredentialOAuth('rootly', { apiKey: 'accessToken' })
export const SENDGRID_CREDENTIAL_OAUTH = tokenCredentialOAuth('sendgrid', { apiKey: 'accessToken' })
export const SENTRY_CREDENTIAL_OAUTH = tokenCredentialOAuth('sentry', { apiKey: 'accessToken' })
export const SIMILARWEB_CREDENTIAL_OAUTH = tokenCredentialOAuth('similarweb', {
  apiKey: 'accessToken',
})
export const SIXTYFOUR_CREDENTIAL_OAUTH = tokenCredentialOAuth('sixtyfour', {
  apiKey: 'accessToken',
})
export const SMARTLEAD_CREDENTIAL_OAUTH = tokenCredentialOAuth('smartlead', {
  apiKey: 'accessToken',
})
export const SPORTMONKS_CREDENTIAL_OAUTH = tokenCredentialOAuth('sportmonks', {
  apiKey: 'accessToken',
})
export const SQUARE_CREDENTIAL_OAUTH = tokenCredentialOAuth('square', { apiKey: 'accessToken' })
export const STRIPE_CREDENTIAL_OAUTH = tokenCredentialOAuth('stripe', { apiKey: 'accessToken' })
export const TAILSCALE_CREDENTIAL_OAUTH = tokenCredentialOAuth('tailscale', {
  apiKey: 'accessToken',
})
export const TAVILY_CREDENTIAL_OAUTH = tokenCredentialOAuth('tavily', { apiKey: 'accessToken' })
export const TELEGRAM_CREDENTIAL_OAUTH = tokenCredentialOAuth('telegram', {
  botToken: 'accessToken',
})
export const TRIGGER_DEV_CREDENTIAL_OAUTH = tokenCredentialOAuth('trigger_dev', {
  apiKey: 'accessToken',
})
export const TYPEFORM_CREDENTIAL_OAUTH = tokenCredentialOAuth('typeform', { apiKey: 'accessToken' })
export const UPTIMEROBOT_CREDENTIAL_OAUTH = tokenCredentialOAuth('uptimerobot', {
  apiKey: 'accessToken',
})
export const VERCEL_CREDENTIAL_OAUTH = tokenCredentialOAuth('vercel', { apiKey: 'accessToken' })
export const WHATSAPP_CREDENTIAL_OAUTH = tokenCredentialOAuth('whatsapp', {
  accessToken: 'accessToken',
})
export const YOUCOM_CREDENTIAL_OAUTH = tokenCredentialOAuth('youcom', { apiKey: 'accessToken' })
export const YOUTUBE_CREDENTIAL_OAUTH = tokenCredentialOAuth('youtube', { apiKey: 'accessToken' })
export const ZEP_CREDENTIAL_OAUTH = tokenCredentialOAuth('zep', { apiKey: 'accessToken' })

/**
 * Every saved-credential policy keyed by the picker's service id. A
 * credential-only block replaces exactly the params its policy supplies, so
 * the block and its tools read one table.
 */
export const SAVED_CREDENTIAL_OAUTH = {
  affinity: AFFINITY_CREDENTIAL_OAUTH,
  agentmail: AGENTMAIL_CREDENTIAL_OAUTH,
  agentphone: AGENTPHONE_CREDENTIAL_OAUTH,
  ahrefs: AHREFS_CREDENTIAL_OAUTH,
  apify: APIFY_CREDENTIAL_OAUTH,
  apollo: APOLLO_CREDENTIAL_OAUTH,
  ashby: ASHBY_CREDENTIAL_OAUTH,
  aws: AWS_CREDENTIAL_OAUTH,
  brex: BREX_CREDENTIAL_OAUTH,
  brightdata: BRIGHTDATA_CREDENTIAL_OAUTH,
  browser_use: BROWSER_USE_CREDENTIAL_OAUTH,
  buffer: BUFFER_CREDENTIAL_OAUTH,
  calendly: CALENDLY_CREDENTIAL_OAUTH,
  checkr: CHECKR_CREDENTIAL_OAUTH,
  circleback: CIRCLEBACK_CREDENTIAL_OAUTH,
  clerk: CLERK_CREDENTIAL_OAUTH,
  cloudflare: CLOUDFLARE_CREDENTIAL_OAUTH,
  crunchbase: CRUNCHBASE_CREDENTIAL_OAUTH,
  cursor: CURSOR_CREDENTIAL_OAUTH,
  databricks: DATABRICKS_CREDENTIAL_OAUTH,
  daytona: DAYTONA_CREDENTIAL_OAUTH,
  discord: DISCORD_CREDENTIAL_OAUTH,
  dub: DUB_CREDENTIAL_OAUTH,
  elevenlabs: ELEVENLABS_CREDENTIAL_OAUTH,
  enrich: ENRICH_CREDENTIAL_OAUTH,
  extend: EXTEND_CREDENTIAL_OAUTH,
  fathom: FATHOM_CREDENTIAL_OAUTH,
  fireflies: FIREFLIES_CREDENTIAL_OAUTH,
  flint: FLINT_CREDENTIAL_OAUTH,
  gamma: GAMMA_CREDENTIAL_OAUTH,
  grain: GRAIN_CREDENTIAL_OAUTH,
  granola: GRANOLA_CREDENTIAL_OAUTH,
  hex: HEX_CREDENTIAL_OAUTH,
  huggingface: HUGGINGFACE_CREDENTIAL_OAUTH,
  incidentio: INCIDENTIO_CREDENTIAL_OAUTH,
  instantly: INSTANTLY_CREDENTIAL_OAUTH,
  intercom: INTERCOM_CREDENTIAL_OAUTH,
  langsmith: LANGSMITH_CREDENTIAL_OAUTH,
  launchdarkly: LAUNCHDARKLY_CREDENTIAL_OAUTH,
  lemlist: LEMLIST_CREDENTIAL_OAUTH,
  linq: LINQ_CREDENTIAL_OAUTH,
  loops: LOOPS_CREDENTIAL_OAUTH,
  luma: LUMA_CREDENTIAL_OAUTH,
  mailchimp: MAILCHIMP_CREDENTIAL_OAUTH,
  mem0: MEM0_CREDENTIAL_OAUTH,
  otter: OTTER_CREDENTIAL_OAUTH,
  pagerduty: PAGERDUTY_CREDENTIAL_OAUTH,
  persona: PERSONA_CREDENTIAL_OAUTH,
  profound: PROFOUND_CREDENTIAL_OAUTH,
  pulse: PULSE_CREDENTIAL_OAUTH,
  quartr: QUARTR_CREDENTIAL_OAUTH,
  quiver: QUIVER_CREDENTIAL_OAUTH,
  rb2b: RB2B_CREDENTIAL_OAUTH,
  reducto: REDUCTO_CREDENTIAL_OAUTH,
  resend: RESEND_CREDENTIAL_OAUTH,
  rippling: RIPPLING_CREDENTIAL_OAUTH,
  rocketlane: ROCKETLANE_CREDENTIAL_OAUTH,
  rootly: ROOTLY_CREDENTIAL_OAUTH,
  sendgrid: SENDGRID_CREDENTIAL_OAUTH,
  sentry: SENTRY_CREDENTIAL_OAUTH,
  similarweb: SIMILARWEB_CREDENTIAL_OAUTH,
  sixtyfour: SIXTYFOUR_CREDENTIAL_OAUTH,
  smartlead: SMARTLEAD_CREDENTIAL_OAUTH,
  sportmonks: SPORTMONKS_CREDENTIAL_OAUTH,
  square: SQUARE_CREDENTIAL_OAUTH,
  stripe: STRIPE_CREDENTIAL_OAUTH,
  tailscale: TAILSCALE_CREDENTIAL_OAUTH,
  tavily: TAVILY_CREDENTIAL_OAUTH,
  telegram: TELEGRAM_CREDENTIAL_OAUTH,
  trigger_dev: TRIGGER_DEV_CREDENTIAL_OAUTH,
  typeform: TYPEFORM_CREDENTIAL_OAUTH,
  uptimerobot: UPTIMEROBOT_CREDENTIAL_OAUTH,
  vercel: VERCEL_CREDENTIAL_OAUTH,
  whatsapp: WHATSAPP_CREDENTIAL_OAUTH,
  youcom: YOUCOM_CREDENTIAL_OAUTH,
  youtube: YOUTUBE_CREDENTIAL_OAUTH,
  zep: ZEP_CREDENTIAL_OAUTH,
} as const

export type SavedCredentialService = keyof typeof SAVED_CREDENTIAL_OAUTH
