import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  type ServiceAccountPrincipal,
  serviceAccountPrincipalMetadata,
} from '@/lib/credentials/principal'
import { parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import { SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import { parseTokenServiceAccountSecretBlob } from '@/lib/credentials/token-service-accounts/server'
import { validateSnowflakeWorkloadIdentity } from '@/lib/credentials/token-service-accounts/validators/snowflake'
import { WORKLOAD_IDENTITY_AUDIENCES } from '@/lib/credentials/workload-identity/audiences'
import {
  isWorkloadIdentityConfigured,
  mintWorkloadIdentityToken,
  type WorkloadIdentityOwner,
} from '@/lib/credentials/workload-identity/issuer'
import {
  bindWorkloadIdentitySubject,
  type WorkloadIdentityCredentialOwner,
  WorkloadIdentityNotConfiguredError,
} from '@/lib/credentials/workload-identity/subject'
import {
  normalizeSnowflakeHost,
  SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE,
} from '@/tools/snowflake/utils'

/**
 * Keyless Snowflake connections: no secret is stored. Sim signs a short-lived
 * OIDC token for the credential's own subject, and the account's service user
 * (created with `WORKLOAD_IDENTITY = (TYPE = OIDC ISSUER = … SUBJECT = …)`)
 * accepts it through workload identity federation on every SQL API request.
 *
 * Snowflake matches the exact `ISSUER` + `SUBJECT` pair, unique per account
 * (https://docs.snowflake.com/en/user-guide/workload-identity-federation), so
 * unlike a Databricks federation policy there is no looser claim match that
 * could let another Sim credential's subject in.
 *
 * Programmatic-access-token credentials share the provider and keep their
 * token-paste blob; only the blob type tells the two modes apart.
 */

const SNOWFLAKE_KEYLESS_SECRET_TYPE = 'snowflake_workload_identity_v1' as const
const SNOWFLAKE_WORKLOAD_IDENTITY_AUDIENCE = WORKLOAD_IDENTITY_AUDIENCES.snowflake

/**
 * Snowflake validates the token on each request, so it only has to outlive one
 * tool call. Cortex Analyst reuses it for the SQL it generates after the
 * answer, which can take longer than the issuer's five-minute default.
 */
const SNOWFLAKE_TOKEN_TTL_SECONDS = 600

const hostSchema = z
  .string()
  .trim()
  .min(1, 'Snowflake account host is required')
  .max(255)
  .transform((value, context) => {
    try {
      return new URL(normalizeSnowflakeHost(value)).hostname
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Enter the account host, like myorg-myaccount.snowflakecomputing.com',
      })
      return z.NEVER
    }
  })

const submittedConfigSchema = z
  .object({
    authType: z.literal('workload_identity'),
    host: hostSchema,
    subject: z.string().min(1).max(512).optional(),
    subjectProof: z.string().min(1).max(512).optional(),
  })
  .strict()

const storedSecretSchema = z
  .object({
    type: z.literal(SNOWFLAKE_KEYLESS_SECRET_TYPE),
    config: z
      .object({
        authType: z.literal('workload_identity'),
        host: z.string().min(1),
        subject: z.string().min(1),
      })
      .strict(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()

type StoredConfig = z.infer<typeof storedSecretSchema>['config']

/** A keyless Snowflake configuration Sim can name the fix for; surfaced to the user as-is. */
export class SnowflakeCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnowflakeCredentialError'
  }
}

/** The auth mode a decrypted Snowflake secret holds: keyless, a token, or undefined when neither. */
export function storedSnowflakeAuthType(
  decrypted: string
): 'workload_identity' | 'programmatic_access_token' | undefined {
  try {
    if (storedSecretSchema.safeParse(JSON.parse(decrypted)).success) return 'workload_identity'
    parseTokenServiceAccountSecretBlob(decrypted, SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID)
    return 'programmatic_access_token'
  } catch {
    return undefined
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success ? parsed.data.config.subject : undefined
}

function mintSnowflakeToken(subject: string, owner: WorkloadIdentityOwner): Promise<string> {
  return mintWorkloadIdentityToken({
    subject,
    audience: SNOWFLAKE_WORKLOAD_IDENTITY_AUDIENCE,
    owner,
    ttlSeconds: SNOWFLAKE_TOKEN_TTL_SECONDS,
  })
}

export interface SnowflakeKeylessSecret {
  encryptedServiceAccountKey: string
  displayName: string
  auditMetadata: Record<string, string>
  principal: ServiceAccountPrincipal | null
  /** A subject this save binds that the credential did not already hold. */
  newWorkloadIdentitySubject?: string
}

/**
 * Validates a keyless configuration, binds its subject to the person saving
 * it, proves the account's service user trusts that subject by running the
 * identity statement with a freshly minted token, and returns the encrypted
 * blob. Snowflake's refusals keep the shared validation codes
 * (`invalid_credentials`, `site_not_found`, `provider_unavailable`); only
 * configuration Sim itself rejects throws {@link SnowflakeCredentialError}.
 */
export async function verifyAndEncryptSnowflakeKeylessCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<SnowflakeKeylessSecret> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedConfigSchema,
    'Snowflake connection'
  )
  if (!parsed.success) throw new SnowflakeCredentialError(parsed.message)
  if (!(await isWorkloadIdentityConfigured())) {
    throw new WorkloadIdentityNotConfiguredError('Use a programmatic access token.')
  }
  const { host, subject: submittedSubject, subjectProof } = parsed.data
  const subject = bindWorkloadIdentitySubject({
    provider: 'snowflake',
    owner,
    storedSubject: readStoredSubject(owner.storedSecret),
    subject: submittedSubject,
    subjectProof,
  })

  const validation = await validateSnowflakeWorkloadIdentity({
    domain: host,
    subjectToken: await mintSnowflakeToken(subject, owner),
  })
  const config: StoredConfig = {
    authType: 'workload_identity',
    host: validation.normalizedDomain ?? host,
    subject,
  }
  const principalMetadata = serviceAccountPrincipalMetadata(validation.principal)
  const { encrypted } = await encryptSecret(
    JSON.stringify({
      type: SNOWFLAKE_KEYLESS_SECRET_TYPE,
      config,
      metadata: { ...validation.storedMetadata, ...principalMetadata },
    })
  )
  return {
    encryptedServiceAccountKey: encrypted,
    displayName: validation.displayName,
    auditMetadata: { ...validation.auditMetadata, ...principalMetadata },
    principal: validation.principal,
    ...(subject !== readStoredSubject(owner.storedSecret)
      ? { newWorkloadIdentitySubject: subject }
      : {}),
  }
}

/**
 * Resolves an executor-authorized Snowflake credential (the executor already
 * checked the caller may use it) to the token and account host the tools send.
 * A programmatic access token resolves exactly as every token-paste credential
 * does; a keyless credential mints a token for its own subject and says so in
 * `authStyle`, which is the only thing that switches the tools' token type.
 */
export async function resolveSnowflakeCredentialToken(credentialId: string): Promise<{
  accessToken: string
  domain?: string
  providerWorkspaceId?: string
  authStyle?: typeof SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE
}> {
  const [row] = await db
    .select({
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  if (!row?.encryptedServiceAccountKey) {
    throw new Error('Token service account secret not found')
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  const keyless = storedSecretSchema.safeParse(JSON.parse(decrypted))
  if (!keyless.success) {
    const secret = parseTokenServiceAccountSecretBlob(
      decrypted,
      SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID
    )
    return {
      accessToken: secret.apiToken,
      domain: secret.domain,
      providerWorkspaceId: secret.providerWorkspaceId,
    }
  }
  const { host, subject } = keyless.data.config
  const owner: WorkloadIdentityOwner = row.workspaceId
    ? { workspaceId: row.workspaceId }
    : { organizationId: row.organizationId ?? undefined }
  return {
    accessToken: await mintSnowflakeToken(subject, owner),
    domain: host,
    authStyle: SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE,
  }
}
