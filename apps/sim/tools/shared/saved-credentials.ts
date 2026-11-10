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
export const BREX_CREDENTIAL_OAUTH = tokenCredentialOAuth('brex', { apiKey: 'accessToken' })
export const BRIGHTDATA_CREDENTIAL_OAUTH = tokenCredentialOAuth('brightdata', {
  apiKey: 'accessToken',
})
export const BROWSER_USE_CREDENTIAL_OAUTH = tokenCredentialOAuth('browser_use', {
  apiKey: 'accessToken',
})
export const BUFFER_CREDENTIAL_OAUTH = tokenCredentialOAuth('buffer', { apiKey: 'accessToken' })
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
export const FIREFLIES_CREDENTIAL_OAUTH = tokenCredentialOAuth('fireflies', {
  apiKey: 'accessToken',
})
export const FLINT_CREDENTIAL_OAUTH = tokenCredentialOAuth('flint', { apiKey: 'accessToken' })
export const GAMMA_CREDENTIAL_OAUTH = tokenCredentialOAuth('gamma', { apiKey: 'accessToken' })
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
export const LINQ_CREDENTIAL_OAUTH = tokenCredentialOAuth('linq', { apiKey: 'accessToken' })
export const LOOPS_CREDENTIAL_OAUTH = tokenCredentialOAuth('loops', { apiKey: 'accessToken' })
export const LUMA_CREDENTIAL_OAUTH = tokenCredentialOAuth('luma', { apiKey: 'accessToken' })
export const MAILCHIMP_CREDENTIAL_OAUTH = tokenCredentialOAuth('mailchimp', {
  apiKey: 'accessToken',
})
export const MEM0_CREDENTIAL_OAUTH = tokenCredentialOAuth('mem0', { apiKey: 'accessToken' })
export const OTTER_CREDENTIAL_OAUTH = tokenCredentialOAuth('otter', { apiKey: 'accessToken' })
export const PERSONA_CREDENTIAL_OAUTH = tokenCredentialOAuth('persona', { apiKey: 'accessToken' })
export const PROFOUND_CREDENTIAL_OAUTH = tokenCredentialOAuth('profound', { apiKey: 'accessToken' })
export const PULSE_CREDENTIAL_OAUTH = tokenCredentialOAuth('pulse', { apiKey: 'accessToken' })
export const QUARTR_CREDENTIAL_OAUTH = tokenCredentialOAuth('quartr', { apiKey: 'accessToken' })
export const QUIVER_CREDENTIAL_OAUTH = tokenCredentialOAuth('quiver', { apiKey: 'accessToken' })
export const RB2B_CREDENTIAL_OAUTH = tokenCredentialOAuth('rb2b', { apiKey: 'accessToken' })
export const REDUCTO_CREDENTIAL_OAUTH = tokenCredentialOAuth('reducto', { apiKey: 'accessToken' })
export const RIPPLING_CREDENTIAL_OAUTH = tokenCredentialOAuth('rippling', { apiKey: 'accessToken' })
export const ROCKETLANE_CREDENTIAL_OAUTH = tokenCredentialOAuth('rocketlane', {
  apiKey: 'accessToken',
})
export const SENDGRID_CREDENTIAL_OAUTH = tokenCredentialOAuth('sendgrid', { apiKey: 'accessToken' })
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
export const TAILSCALE_CREDENTIAL_OAUTH = tokenCredentialOAuth('tailscale', {
  apiKey: 'accessToken',
})
export const TAVILY_CREDENTIAL_OAUTH = tokenCredentialOAuth('tavily', { apiKey: 'accessToken' })
export const TRIGGER_DEV_CREDENTIAL_OAUTH = tokenCredentialOAuth('trigger_dev', {
  apiKey: 'accessToken',
})
export const UPTIMEROBOT_CREDENTIAL_OAUTH = tokenCredentialOAuth('uptimerobot', {
  apiKey: 'accessToken',
})
export const YOUCOM_CREDENTIAL_OAUTH = tokenCredentialOAuth('youcom', { apiKey: 'accessToken' })
export const YOUTUBE_CREDENTIAL_OAUTH = tokenCredentialOAuth('youtube', { apiKey: 'accessToken' })
export const ZEP_CREDENTIAL_OAUTH = tokenCredentialOAuth('zep', { apiKey: 'accessToken' })
