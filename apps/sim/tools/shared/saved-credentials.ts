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
