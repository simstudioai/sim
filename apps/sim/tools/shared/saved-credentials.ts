import type { OAuthConfig } from '@/tools/types'

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
