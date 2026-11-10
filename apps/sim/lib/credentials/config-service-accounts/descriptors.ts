/**
 * Client-safe descriptors for configuration service-account providers (AWS, Databricks).
 *
 * A configuration service account is a `service_account`-type credential whose secret is a JSON
 * configuration, submitted as `serviceAccountJson`, with an `authType` choosing how Sim signs in.
 * One auth type is keyless: the cloud trusts a short-lived token Sim's workload-identity issuer
 * signs, so the customer pastes Sim's issuer, audience and subject into their cloud instead of
 * giving Sim a secret. Each auth type shows and submits only its own fields. Server verification
 * lives in `@/lib/credentials/aws-service-account.server` and
 * `@/lib/credentials/databricks-service-account.server`.
 */
import type { WorkloadIdentityProvider } from '@/lib/credentials/workload-identity/audiences'
import {
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

export interface ConfigServiceAccountAuthType {
  value: string
  label: string
  /** What this choice stores, shown under the choice. */
  hint: string
  /** Signs in through Sim's workload-identity issuer, so it needs a deployment with one. */
  keyless?: boolean
}

export interface ConfigServiceAccountField {
  /** The configuration key the server reads. */
  id: string
  label: string
  placeholder: string
  /** Submitted exactly as entered, masked, and never prefilled. */
  secret?: boolean
  /** Left out of the configuration when empty. */
  optional?: boolean
  hint?: string
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
  fields: readonly ConfigServiceAccountField[]
  displayNamePlaceholder: string
  /** The one snippet that makes the customer's cloud trust this keyless credential. */
  trustSnippet: {
    label: string
    hint: string
    build: (trust: KeylessTrust, values: Readonly<Record<string, string>>) => string
  }
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
      hint: 'No keys are stored. Sim signs a short-lived token that your role trusts.',
      keyless: true,
    },
    {
      value: 'access_keys',
      label: 'Access keys',
      hint: 'Sim signs requests with these long-lived keys.',
    },
    {
      value: 'assume_role',
      label: 'Access keys that assume an IAM role',
      hint: 'Sim uses the keys only to assume the role, then works with temporary credentials.',
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
      label: 'STS region',
      placeholder: 'us-east-1',
      optional: true,
      hint: 'Only needed for AWS GovCloud or China keys, e.g. us-gov-west-1 or cn-north-1.',
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
  displayNamePlaceholder: 'Defaults to the AWS identity ARN',
  trustSnippet: {
    label: 'Role trust policy',
    hint: 'Add the issuer and audience above as an IAM identity provider (once per AWS account), set this as the role’s trust policy, then grant the role the permissions your workflows need.',
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
      hint: 'No secret is stored. Sim signs a short-lived token your service principal trusts.',
      keyless: true,
    },
    {
      value: 'service_principal',
      label: 'Service principal OAuth secret',
      hint: 'Sim exchanges the OAuth secret for a short-lived workspace token on each run.',
    },
    {
      value: 'personal_access_token',
      label: 'Personal access token',
      hint: 'Sim sends this token on every request.',
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
  displayNamePlaceholder: 'Defaults to the Databricks identity',
  trustSnippet: {
    label: 'Federation policy',
    hint: 'An account admin runs this once, with the service principal’s numeric ID, before you save.',
    build: (trust) => buildDatabricksFederationCommand(trust),
  },
}

const DESCRIPTORS: Record<string, ConfigServiceAccountDescriptor> = {
  [AWS.providerId]: AWS,
  [DATABRICKS.providerId]: DATABRICKS,
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
    const value = field.secret ? raw : raw.trim()
    if (value) config[field.id] = value
  }
  return config
}
