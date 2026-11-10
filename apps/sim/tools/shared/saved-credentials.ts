import type { OAuthService } from '@/lib/oauth'
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
 * Credential policy for every Databricks tool. The inline host and personal
 * access token keep working; a saved Databricks connection resolves to a
 * bearer token and workspace host, which reach the tools as `accessToken` and
 * `domain` (see `databricksToken` / `databricksHost`).
 */
export const DATABRICKS_CREDENTIAL_OAUTH = {
  required: false,
  provider: 'databricks',
  credentialKind: 'service-account',
  credentialSuppliedParams: ['host', 'apiKey'],
  /** The saved connection's workspace host always replaces a caller-supplied one. */
  authoritativeParams: ['domain'],
} as const satisfies OAuthConfig

/**
 * Saved-credential providers whose tools resolve the credential inside their
 * own operation (AWS session keys, Databricks token helpers) rather than
 * through `credentialParams`.
 */
export const OPERATION_RESOLVED_CREDENTIAL_PROVIDERS: ReadonlySet<string> = new Set([
  AWS_CREDENTIAL_OAUTH.provider,
  DATABRICKS_CREDENTIAL_OAUTH.provider,
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
