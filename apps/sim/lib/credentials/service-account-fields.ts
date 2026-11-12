import { CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  CLIENT_CREDENTIALS_AUTH_METHOD,
  TOKEN_SERVICE_ACCOUNT_CLIENT_CREDENTIAL_FIELDS,
  TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { isWorkloadIdentityServiceAccountProviderId } from '@/lib/credentials/workload-identity/audiences'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'

export const ATLASSIAN_PRODUCTS = ['jira', 'confluence'] as const
export type AtlassianProduct = (typeof ATLASSIAN_PRODUCTS)[number]

/** Every secret field a service-account credential create/reconnect can carry. */
export type ServiceAccountFieldId =
  | 'apiToken'
  | 'domain'
  | 'providerWorkspaceId'
  | 'atlassianProduct'
  | 'serviceAccountJson'
  | 'signingSecret'
  | 'botToken'
  | 'clientId'
  | 'clientSecret'
  | 'certificateId'
  | 'orgId'
  | 'dataCenter'
  | 'scope'
  | 'authMethod'
  | 'privateKey'
  | 'username'
  | 'tenancyOcid'
  | 'userOcid'
  | 'fingerprint'
  | 'privateKeyPassphrase'
  | 'region'

/**
 * Required create-body fields per service-account provider — the client-safe
 * source of truth consumed by the `createCredentialBodySchema` superRefine.
 * (Server-side builders re-derive their own requirements: token-paste
 * providers from descriptor fields, bespoke providers inline.) Token-paste
 * providers contribute their entries from
 * `TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS`, client-credential providers from
 * `CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS`; the four bespoke providers are
 * declared here.
 */
export const SERVICE_ACCOUNT_REQUIRED_FIELDS: Record<string, readonly ServiceAccountFieldId[]> = {
  [ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID]: ['serviceAccountJson'],
  [AWS_SERVICE_ACCOUNT_PROVIDER_ID]: ['serviceAccountJson'],
  [DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID]: ['serviceAccountJson'],
  [MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID]: ['serviceAccountJson'],
  [GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID]: ['serviceAccountJson'],
  [ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID]: ['apiToken', 'domain'],
  [SLACK_CUSTOM_BOT_PROVIDER_ID]: ['signingSecret', 'botToken'],
  [OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID]: [
    'tenancyOcid',
    'userOcid',
    'fingerprint',
    'privateKey',
    'region',
  ],
  ...TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS,
  ...CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS,
}

/**
 * Legacy Google creates may omit `providerId` entirely (the original
 * service-account flow predates multi-provider support), so an unknown or
 * missing provider falls back to requiring the Google JSON key.
 */
export const FALLBACK_SERVICE_ACCOUNT_REQUIRED_FIELDS: readonly ServiceAccountFieldId[] = [
  'serviceAccountJson',
]

/** Every keyless credential is one JSON configuration carrying its subject and proof. */
const KEYLESS_REQUIRED_FIELDS: readonly ServiceAccountFieldId[] = ['serviceAccountJson']

/**
 * The create-body fields a keyless (workload identity) credential sends in
 * place of the provider's required fields, or `undefined` for a provider with
 * no keyless mode. For most keyless providers this is their only field; for
 * Snowflake it replaces the token fields. The keyless builder validates the
 * configuration itself.
 */
function getKeylessServiceAccountFields(
  providerId: string | null | undefined
): readonly ServiceAccountFieldId[] | undefined {
  return isWorkloadIdentityServiceAccountProviderId(providerId)
    ? KEYLESS_REQUIRED_FIELDS
    : undefined
}

function getServiceAccountRequiredFields(
  providerId: string | null | undefined
): readonly ServiceAccountFieldId[] {
  return providerId && Object.hasOwn(SERVICE_ACCOUNT_REQUIRED_FIELDS, providerId)
    ? SERVICE_ACCOUNT_REQUIRED_FIELDS[providerId]
    : FALLBACK_SERVICE_ACCOUNT_REQUIRED_FIELDS
}

/**
 * Required create-body fields for providers whose primary mode is a pasted token but which also
 * offer a client-credentials grant, selected by `authMethod: 'client_credentials'`.
 */
const CLIENT_CREDENTIALS_MODE_REQUIRED_FIELDS: Record<string, readonly ServiceAccountFieldId[]> = {
  [ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID]: ['clientId', 'clientSecret', 'domain'],
  ...TOKEN_SERVICE_ACCOUNT_CLIENT_CREDENTIAL_FIELDS,
}

/**
 * Whether a provider's primary mode is a pasted token but it also offers a client-credentials
 * mode, which the secret records as `authMethod: 'client_credentials'`.
 */
export function offersClientCredentialsMode(providerId: string | null | undefined): boolean {
  return Boolean(providerId && Object.hasOwn(CLIENT_CREDENTIALS_MODE_REQUIRED_FIELDS, providerId))
}

function getClientCredentialsModeFields(
  providerId: string | null | undefined,
  authMethod: unknown
): readonly ServiceAccountFieldId[] | undefined {
  return authMethod === CLIENT_CREDENTIALS_AUTH_METHOD &&
    providerId &&
    offersClientCredentialsMode(providerId)
    ? CLIENT_CREDENTIALS_MODE_REQUIRED_FIELDS[providerId]
    : undefined
}

/**
 * The required create-body fields a submission is missing: none when it
 * completes the provider's keyless alternative, the client-credentials fields
 * when it selects that mode, otherwise the provider's own required fields that
 * are empty.
 */
export function getMissingServiceAccountFields(
  providerId: string | null | undefined,
  provided: Partial<Record<ServiceAccountFieldId, unknown>>
): ServiceAccountFieldId[] {
  const keyless = getKeylessServiceAccountFields(providerId)
  if (keyless?.every((field) => provided[field])) return []
  const required =
    getClientCredentialsModeFields(providerId, provided.authMethod) ??
    getServiceAccountRequiredFields(providerId)
  return required.filter((field) => !provided[field])
}
