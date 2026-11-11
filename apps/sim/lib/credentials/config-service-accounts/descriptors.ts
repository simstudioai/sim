/**
 * Client-safe descriptors for configuration service-account providers (AWS, Databricks, Snowflake,
 * Microsoft app credentials) and the keyless mode of a Google service account.
 *
 * A configuration service account is a `service_account`-type credential whose secret is a JSON
 * configuration, submitted as `serviceAccountJson`, with an `authType` choosing how Sim signs in.
 * One auth type is keyless: the cloud trusts a short-lived token Sim's workload-identity issuer
 * signs, so the customer pastes Sim's issuer, audience and subject into their cloud instead of
 * giving Sim a secret. Each auth type shows and submits only its own fields. Server verification
 * lives in each provider's `@/lib/credentials/*-service-account.server` module.
 */
import {
  GOOGLE_KEYLESS_SERVICES,
  googleWorkloadIdentityAudience,
  googleWorkloadIdentitySetupCommands,
  isGoogleProjectNumber,
  isGoogleServiceAccountEmail,
  isGoogleWorkloadIdentityId,
} from '@/lib/credentials/google-workload-identity'
import {
  getTokenServiceAccountDescriptor,
  getTokenServiceAccountErrorMessage,
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/token-service-accounts/descriptors'
import type { WorkloadIdentityProvider } from '@/lib/credentials/workload-identity/audiences'
import {
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

interface ConfigServiceAccountAuthType {
  value: string
  label: string
  /** Signs in through Sim's workload-identity issuer, so it needs a deployment with one. */
  keyless?: boolean
}

interface ConfigServiceAccountField {
  /** The configuration key the server reads. */
  id: string
  label: string
  placeholder: string
  /** Submitted exactly as entered, masked, and never prefilled. */
  secret?: boolean
  /** Left out of the configuration when empty. */
  optional?: boolean
  /** A PEM block or other value that spans lines. */
  multiline?: boolean
  /** Rewrites the entered value into the form the server reads, such as a bare host. */
  normalize?: (value: string) => string
  /** The shape a non-empty value must have, checked after `normalize`, and what to say when not. */
  format?: { pattern: RegExp; message: string }
  /** The auth types that show and submit this field. */
  authTypes: readonly string[]
}

/** The values a keyless credential's cloud must trust. */
export interface KeylessTrust {
  issuer: string
  audience: string
  subject: string
}

export interface ConfigServiceAccountDescriptor {
  providerId: string
  serviceLabel: string
  /** The noun after the service in "Add AWS credential". */
  connectNoun: string
  docsUrl: string
  workloadIdentityProvider: WorkloadIdentityProvider
  authTypes: readonly ConfigServiceAccountAuthType[]
  /** The auth type a new credential starts on where keyless is not offered. */
  keyedDefault: string
  /** A new credential starts on `keyedDefault` even where keyless is offered (Google). */
  keyedFirst?: boolean
  /**
   * The workload-identity setup reports whether a reconnected credential is keyless, so a
   * reconnect opens on keyless only for one that is (Snowflake, Microsoft, Google).
   */
  reconnectReportsMode?: boolean
  fields: readonly ConfigServiceAccountField[]
  /** Whether the keyless fields are complete enough to verify, beyond each being filled in. */
  keylessReady?: (values: Readonly<Record<string, string>>) => boolean
  /**
   * The audience this credential's token carries, for a provider without a fixed one (Google:
   * the customer's own workload identity provider), or undefined until the fields name it.
   */
  audience?: (values: Readonly<Record<string, string>>) => string | undefined
  /** The one snippet that makes the customer's cloud trust this keyless credential. */
  trustSnippet?: {
    label: string
    /** The snippet, or undefined until the fields it needs are filled in. */
    build: (trust: KeylessTrust, values: Readonly<Record<string, string>>) => string | undefined
  }
  /**
   * Auth types saved as the create body's own fields rather than a `serviceAccountJson`
   * configuration (Snowflake's programmatic access token), mapping each field id to its body field.
   */
  bodyFields?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Copy for a shared verification code the server reports without its own wording. */
  errorMessage?: (code: string, authType: string) => string | undefined
}

const ACCOUNT_ID_FROM_ROLE_ARN = /^arn:aws[\w-]*:iam::(\d{12}):role\//

/** The trust policy a customer attaches to the role so it trusts exactly this credential. */
export function buildAwsTrustPolicy(trust: KeylessTrust, roleArn: string): string {
  const issuerHostPath = trust.issuer.replace(/^https:\/\//, '')
  const trimmedArn = roleArn.trim()
  const accountId = ACCOUNT_ID_FROM_ROLE_ARN.exec(trimmedArn)?.[1] ?? '<AWS_ACCOUNT_ID>'
  const partition = trimmedArn.startsWith('arn:aws-') ? trimmedArn.split(':')[1] : 'aws'
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: `arn:${partition}:iam::${accountId}:oidc-provider/${issuerHostPath}`,
          },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              [`${issuerHostPath}:aud`]: trust.audience,
              [`${issuerHostPath}:sub`]: trust.subject,
            },
          },
        },
      ],
    },
    null,
    2
  )
}

/** The account-level CLI command that makes the service principal trust this credential. */
export function buildDatabricksFederationCommand(trust: KeylessTrust): string {
  const policy = JSON.stringify({
    oidc_policy: { issuer: trust.issuer, audiences: [trust.audience], subject: trust.subject },
  })
  return `databricks account service-principal-federation-policy create <SERVICE_PRINCIPAL_NUMERIC_ID> --json '${policy}'`
}

const AWS: ConfigServiceAccountDescriptor = {
  providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  serviceLabel: 'AWS',
  connectNoun: 'credential',
  docsUrl: 'https://docs.sim.ai/integrations/aws-credentials',
  workloadIdentityProvider: 'aws',
  authTypes: [
    {
      value: 'oidc_role',
      label: 'IAM role (keyless, via Sim OIDC)',
      keyless: true,
    },
    {
      value: 'access_keys',
      label: 'Access keys (long-lived)',
    },
    {
      value: 'assume_role',
      label: 'Access keys that assume an IAM role',
    },
  ],
  keyedDefault: 'access_keys',
  fields: [
    {
      id: 'accessKeyId',
      label: 'Access key ID',
      placeholder: 'AKIA...',
      authTypes: ['access_keys', 'assume_role'],
    },
    {
      id: 'secretAccessKey',
      label: 'Secret access key',
      placeholder: 'Enter the secret access key',
      secret: true,
      authTypes: ['access_keys', 'assume_role'],
    },
    {
      id: 'stsRegion',
      label: 'GovCloud or China STS region',
      placeholder: 'us-gov-west-1',
      optional: true,
      authTypes: ['access_keys'],
    },
    {
      id: 'roleArn',
      label: 'Role ARN',
      placeholder: 'arn:aws:iam::123456789012:role/sim-workflows',
      authTypes: ['oidc_role', 'assume_role'],
    },
    {
      id: 'externalId',
      label: 'External ID',
      placeholder: 'Optional, if the role requires one',
      optional: true,
      authTypes: ['assume_role'],
    },
  ],
  trustSnippet: {
    label: 'Role trust policy',
    build: (trust, values) => buildAwsTrustPolicy(trust, values.roleArn ?? ''),
  },
}

const DATABRICKS: ConfigServiceAccountDescriptor = {
  providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  serviceLabel: 'Databricks',
  connectNoun: 'connection',
  docsUrl: 'https://docs.sim.ai/integrations/databricks-credentials',
  workloadIdentityProvider: 'databricks',
  authTypes: [
    {
      value: 'oidc_federation',
      label: 'Service principal (keyless, via Sim OIDC)',
      keyless: true,
    },
    {
      value: 'service_principal',
      label: 'Service principal OAuth secret',
    },
    {
      value: 'personal_access_token',
      label: 'Personal access token',
    },
  ],
  keyedDefault: 'service_principal',
  fields: [
    {
      id: 'host',
      label: 'Workspace host',
      placeholder: 'dbc-abc123.cloud.databricks.com',
      authTypes: ['oidc_federation', 'service_principal', 'personal_access_token'],
    },
    {
      id: 'token',
      label: 'Personal access token',
      placeholder: 'dapi...',
      secret: true,
      authTypes: ['personal_access_token'],
    },
    {
      id: 'clientId',
      label: 'Service principal application ID',
      placeholder: '7cb2f8a4-49a7-4147-83db-35cb69e5cede',
      authTypes: ['oidc_federation', 'service_principal'],
    },
    {
      id: 'clientSecret',
      label: 'OAuth secret',
      placeholder: 'Enter the service principal OAuth secret',
      secret: true,
      authTypes: ['service_principal'],
    },
  ],
  trustSnippet: {
    label: 'Federation policy',
    build: (trust) => buildDatabricksFederationCommand(trust),
  },
}

/** The statement that creates a Snowflake service user trusting only this credential's subject. */
function buildSnowflakeCreateUserStatement(trust: KeylessTrust): string {
  return [
    'CREATE USER SIM_WORKFLOWS',
    '  WORKLOAD_IDENTITY = (',
    '    TYPE = OIDC',
    `    ISSUER = '${trust.issuer}'`,
    `    SUBJECT = '${trust.subject}'`,
    '  )',
    '  TYPE = SERVICE;',
  ].join('\n')
}

function bareHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
}

const SNOWFLAKE_TOKEN = getTokenServiceAccountDescriptor(SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID)

const SNOWFLAKE: ConfigServiceAccountDescriptor = {
  providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  serviceLabel: 'Snowflake',
  connectNoun: 'connection',
  docsUrl: 'https://docs.sim.ai/integrations/snowflake-service-account',
  workloadIdentityProvider: 'snowflake',
  authTypes: [
    {
      value: 'workload_identity',
      label: 'Service user (keyless, via Sim OIDC)',
      keyless: true,
    },
    {
      value: 'programmatic_access_token',
      label: 'Programmatic access token',
    },
  ],
  keyedDefault: 'programmatic_access_token',
  reconnectReportsMode: true,
  fields: [
    {
      id: 'host',
      label: 'Account host',
      placeholder: 'myorg-myaccount.snowflakecomputing.com',
      normalize: bareHost,
      format: {
        pattern: /^[a-z0-9][a-z0-9.-]*\.snowflakecomputing\.(com|cn)$/i,
        message: 'Snowflake account hosts end in .snowflakecomputing.com.',
      },
      authTypes: ['workload_identity', 'programmatic_access_token'],
    },
    {
      id: 'apiToken',
      label: 'Programmatic access token',
      placeholder: 'Paste a programmatic access token',
      secret: true,
      authTypes: ['programmatic_access_token'],
    },
  ],
  trustSnippet: {
    label: 'Service user statement',
    build: (trust) => buildSnowflakeCreateUserStatement(trust),
  },
  bodyFields: { programmatic_access_token: { host: 'domain', apiToken: 'apiToken' } },
  errorMessage: (code, authType) => {
    if (authType === 'programmatic_access_token')
      return SNOWFLAKE_TOKEN ? getTokenServiceAccountErrorMessage(SNOWFLAKE_TOKEN, code) : undefined
    switch (code) {
      case 'invalid_credentials':
        return 'Snowflake did not accept Sim’s token. Check that a service user on this account was created with exactly the issuer and subject shown, that a network policy allows Sim to reach the account, and that no authentication policy blocks workload identity.'
      case 'site_not_found':
        return "We couldn't find a Snowflake account at that host. It should look like myorg-myaccount.snowflakecomputing.com."
      case 'provider_unavailable':
        return "We couldn't reach Snowflake to verify this connection. Try again in a moment."
      default:
        return undefined
    }
  },
}

const MICROSOFT_APP: ConfigServiceAccountDescriptor = {
  providerId: MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
  serviceLabel: 'Microsoft',
  connectNoun: 'app credential',
  docsUrl: 'https://docs.sim.ai/integrations/microsoft-app-credentials',
  workloadIdentityProvider: 'microsoft',
  authTypes: [
    {
      value: 'federated',
      label: 'Federated credential (keyless, via Sim OIDC)',
      keyless: true,
    },
    { value: 'client_secret', label: 'Client secret' },
    { value: 'certificate', label: 'Certificate' },
  ],
  keyedDefault: 'client_secret',
  reconnectReportsMode: true,
  fields: [
    {
      id: 'tenantId',
      label: 'Directory (tenant) ID',
      placeholder: '00000000-0000-0000-0000-000000000000',
      authTypes: ['federated', 'client_secret', 'certificate'],
    },
    {
      id: 'clientId',
      label: 'Application (client) ID',
      placeholder: '00000000-0000-0000-0000-000000000000',
      authTypes: ['federated', 'client_secret', 'certificate'],
    },
    {
      id: 'environmentUrl',
      label: 'Dataverse or Dynamics 365 environment URL',
      placeholder: 'https://contoso.crm.dynamics.com',
      optional: true,
      authTypes: ['federated', 'client_secret', 'certificate'],
    },
    {
      id: 'clientSecret',
      label: 'Client secret',
      placeholder: 'The secret’s value from Certificates & secrets',
      secret: true,
      authTypes: ['client_secret'],
    },
    {
      id: 'certificate',
      label: 'Certificate',
      placeholder: '-----BEGIN CERTIFICATE-----',
      multiline: true,
      authTypes: ['certificate'],
    },
    {
      id: 'privateKey',
      label: 'Private key (unencrypted PEM)',
      placeholder: '-----BEGIN PRIVATE KEY-----',
      secret: true,
      multiline: true,
      authTypes: ['certificate'],
    },
  ],
}

/** The workload identity provider and service account the fields name, once all are valid. */
function googleKeylessRef(values: Readonly<Record<string, string>>) {
  const ref = {
    projectNumber: (values.projectNumber ?? '').trim(),
    poolId: (values.poolId ?? '').trim(),
    providerId: (values.providerId ?? '').trim(),
    serviceAccountEmail: (values.serviceAccountEmail ?? '').trim().toLowerCase(),
  }
  return isGoogleProjectNumber(ref.projectNumber) &&
    isGoogleWorkloadIdentityId(ref.poolId) &&
    isGoogleWorkloadIdentityId(ref.providerId) &&
    isGoogleServiceAccountEmail(ref.serviceAccountEmail)
    ? ref
    : undefined
}

/**
 * The keyless mode of a Google service account (Workload Identity Federation, for Google Cloud
 * services only). The JSON key mode has its own dialog fields, so `json_key` lists none here.
 */
const GOOGLE_KEYLESS_DESCRIPTOR: ConfigServiceAccountDescriptor = {
  providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  serviceLabel: 'Google',
  connectNoun: 'service account',
  docsUrl: 'https://docs.sim.ai/integrations/google-service-account',
  workloadIdentityProvider: 'google',
  authTypes: [
    { value: 'json_key', label: 'JSON key' },
    {
      value: 'workload_identity',
      label: 'Workload Identity Federation (keyless, via Sim OIDC)',
      keyless: true,
    },
  ],
  keyedDefault: 'json_key',
  keyedFirst: true,
  reconnectReportsMode: true,
  fields: [
    {
      id: 'projectNumber',
      label: 'Project number (numeric, not the project ID)',
      placeholder: '123456789012',
      authTypes: ['workload_identity'],
    },
    {
      id: 'poolId',
      label: 'Workload identity pool ID',
      placeholder: 'sim',
      authTypes: ['workload_identity'],
    },
    {
      id: 'providerId',
      label: 'Provider ID',
      placeholder: 'sim-oidc',
      authTypes: ['workload_identity'],
    },
    {
      id: 'serviceAccountEmail',
      label: 'Service account email',
      placeholder: 'name@project-id.iam.gserviceaccount.com',
      normalize: (value) => value.trim().toLowerCase(),
      authTypes: ['workload_identity'],
    },
  ],
  keylessReady: (values) => Boolean(googleKeylessRef(values)),
  audience: (values) => {
    const ref = googleKeylessRef(values)
    return ref ? googleWorkloadIdentityAudience(ref) : undefined
  },
  trustSnippet: {
    label: 'Setup commands',
    build: (trust, values) => {
      const ref = googleKeylessRef(values)
      return ref
        ? googleWorkloadIdentitySetupCommands({
            ref,
            serviceAccountEmail: ref.serviceAccountEmail,
            issuer: trust.issuer,
            subject: trust.subject,
          })
        : undefined
    },
  },
}

/**
 * The keyless Google setup a dialog opened for this OAuth service offers: only a Google Cloud
 * service (BigQuery, Vertex AI) can use a keyless credential, so any other service gets none.
 */
export function getGoogleKeylessDescriptor(
  oauthServiceId: string | undefined
): ConfigServiceAccountDescriptor | undefined {
  return oauthServiceId && GOOGLE_KEYLESS_SERVICES.has(oauthServiceId)
    ? GOOGLE_KEYLESS_DESCRIPTOR
    : undefined
}

const DESCRIPTORS: Record<string, ConfigServiceAccountDescriptor> = {
  [AWS.providerId]: AWS,
  [DATABRICKS.providerId]: DATABRICKS,
  [SNOWFLAKE.providerId]: SNOWFLAKE,
  [MICROSOFT_APP.providerId]: MICROSOFT_APP,
}

export function getConfigServiceAccountDescriptor(
  providerId: string | undefined
): ConfigServiceAccountDescriptor | undefined {
  return providerId ? DESCRIPTORS[providerId] : undefined
}

/**
 * The configuration an auth type submits: its own fields, a secret exactly as entered and every
 * other value trimmed, with an empty optional field left out.
 */
export function buildConfigServiceAccountConfig(
  descriptor: ConfigServiceAccountDescriptor,
  authType: string,
  values: Readonly<Record<string, string>>
): Record<string, string> {
  const config: Record<string, string> = { authType }
  for (const field of descriptor.fields) {
    if (!field.authTypes.includes(authType)) continue
    const raw = values[field.id] ?? ''
    const value = field.secret ? raw : (field.normalize?.(raw) ?? raw.trim())
    if (value) config[field.id] = value
  }
  return config
}
