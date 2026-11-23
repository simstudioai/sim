import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  type ServiceAccountPrincipal,
  serviceAccountPrincipalMetadata,
} from '@/lib/credentials/principal'
import { parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import { SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import { parseTokenServiceAccountSecretBlob } from '@/lib/credentials/token-service-accounts/server'
import {
  validateSnowflakeKeyPair,
  validateSnowflakeWorkloadIdentity,
} from '@/lib/credentials/token-service-accounts/validators/snowflake'
import {
  storedAudienceField,
  storedWorkloadIdentityAudienceSchema,
  WORKLOAD_IDENTITY_AUDIENCES,
  workloadIdentityAudienceSchema,
} from '@/lib/credentials/workload-identity/audiences'
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
  SNOWFLAKE_KEY_PAIR_AUTH_STYLE,
  SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE,
  snowflakeAccountIdentifier,
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
 * Key-pair connections store the user's unencrypted private key instead, and
 * Sim signs a short-lived JWT with it for every run
 * (https://docs.snowflake.com/en/developer-guide/sql-api/authenticating).
 *
 * The token's `aud` is `snowflakecomputing.com` unless the credential sets its
 * own `audience`, which the user then lists in `OIDC_AUDIENCE_LIST`.
 *
 * Programmatic-access-token credentials share the provider and keep their
 * token-paste blob; only the blob type tells the three modes apart.
 */

const SNOWFLAKE_KEYLESS_SECRET_TYPE = 'snowflake_workload_identity_v1' as const
const SNOWFLAKE_KEY_PAIR_SECRET_TYPE = 'snowflake_key_pair_v1' as const

/** Snowflake honors a key-pair JWT for at most an hour; its own example signs for 59 minutes. */
const SNOWFLAKE_KEY_PAIR_JWT_TTL_SECONDS = 59 * 60
/** Snowflake requires at least a 2048-bit RSA key; larger keys are accepted up to this bound. */
const MIN_RSA_MODULUS_BITS = 2048
const MAX_RSA_MODULUS_BITS = 4096
const MAX_PRIVATE_KEY_LENGTH = 16 * 1024
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
    audience: workloadIdentityAudienceSchema('snowflake').optional(),
  })
  .strict()

/** A Snowflake user name, sent uppercased in the JWT as Snowflake's own drivers do. */
const userSchema = z
  .string()
  .trim()
  .min(1, 'Snowflake user is required')
  .max(255)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Enter the Snowflake user name')

const submittedKeyPairSchema = z
  .object({
    authType: z.literal('key_pair'),
    host: hostSchema,
    user: userSchema,
    privateKey: z
      .string()
      .trim()
      .min(1, 'Private key is required')
      .max(MAX_PRIVATE_KEY_LENGTH, 'Private key is too large'),
  })
  .strict()

/** Picks the mode a submitted configuration is for, so each is parsed by its own strict schema. */
const submittedModeSchema = z.object({ authType: z.enum(['workload_identity', 'key_pair']) })

const storedSecretSchema = z
  .object({
    type: z.literal(SNOWFLAKE_KEYLESS_SECRET_TYPE),
    config: z
      .object({
        authType: z.literal('workload_identity'),
        host: z.string().min(1),
        subject: z.string().min(1),
        /** Absent for the default audience, so earlier releases' strict schema still reads it. */
        audience: storedWorkloadIdentityAudienceSchema,
      })
      .strict(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()

type StoredConfig = z.infer<typeof storedSecretSchema>['config']

const storedKeyPairSecretSchema = z
  .object({
    type: z.literal(SNOWFLAKE_KEY_PAIR_SECRET_TYPE),
    config: z
      .object({
        authType: z.literal('key_pair'),
        host: z.string().min(1),
        user: z.string().min(1),
        privateKey: z.string().min(1),
      })
      .strict(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()

type StoredKeyPairConfig = z.infer<typeof storedKeyPairSecretSchema>['config']

/** A keyless Snowflake configuration Sim can name the fix for; surfaced to the user as-is. */
export class SnowflakeCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnowflakeCredentialError'
  }
}

/**
 * The auth mode and custom keyless audience a decrypted Snowflake secret holds, for a
 * reconnect to reopen on: empty when it is none of the three modes, and no audience for
 * one that uses the default.
 */
export function storedSnowflakeReconnectFields(decrypted: string): {
  authType?: 'workload_identity' | 'key_pair' | 'programmatic_access_token'
  audience?: string
} {
  try {
    const parsed: unknown = JSON.parse(decrypted)
    const keyless = storedSecretSchema.safeParse(parsed)
    if (keyless.success) {
      const { audience } = keyless.data.config
      return { authType: 'workload_identity', ...(audience ? { audience } : {}) }
    }
    if (storedKeyPairSecretSchema.safeParse(parsed).success) return { authType: 'key_pair' }
    parseTokenServiceAccountSecretBlob(decrypted, SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID)
    return { authType: 'programmatic_access_token' }
  } catch {
    return {}
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success ? parsed.data.config.subject : undefined
}

function mintSnowflakeToken(
  config: Pick<StoredConfig, 'subject' | 'audience'>,
  owner: WorkloadIdentityOwner
): Promise<string> {
  return mintWorkloadIdentityToken({
    subject: config.subject,
    audience: config.audience ?? SNOWFLAKE_WORKLOAD_IDENTITY_AUDIENCE,
    owner,
    ttlSeconds: SNOWFLAKE_TOKEN_TTL_SECONDS,
  })
}

/** The account and user a key-pair JWT names, both uppercased. */
function snowflakeQualifiedUser(host: string, user: string): string {
  return `${snowflakeAccountIdentifier(host)}.${user.toUpperCase()}`
}

/**
 * Loads the private key a key-pair connection signs with, refusing one
 * Snowflake would reject anyway so the person sees what to fix before
 * anything is sent.
 */
function loadSnowflakePrivateKey(privateKeyPem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPrivateKey(privateKeyPem)
  } catch {
    throw new SnowflakeCredentialError(
      'The private key is not a readable, unencrypted PEM private key (-----BEGIN PRIVATE KEY-----).'
    )
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new SnowflakeCredentialError(
      'Snowflake key-pair authentication needs an RSA private key.'
    )
  }
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0
  if (bits < MIN_RSA_MODULUS_BITS || bits > MAX_RSA_MODULUS_BITS) {
    throw new SnowflakeCredentialError(
      `The RSA private key is ${bits}-bit; use a 2048- to 4096-bit key.`
    )
  }
  return key
}

/**
 * Signs the JWT a key-pair connection presents: `iss` is
 * `ACCOUNT.USER.SHA256:<public key fingerprint>`, `sub` is `ACCOUNT.USER`, and
 * the fingerprint is the base64 SHA-256 of the DER public key, as Snowflake's
 * `RSA_PUBLIC_KEY_FP` shows it.
 */
function signSnowflakeKeyPairJwt(
  config: Pick<StoredKeyPairConfig, 'host' | 'user' | 'privateKey'>
) {
  const key = loadSnowflakePrivateKey(config.privateKey)
  const fingerprint = createHash('sha256')
    .update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .digest('base64')
  const qualifiedUser = snowflakeQualifiedUser(config.host, config.user)
  const issuedAt = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(`${qualifiedUser}.SHA256:${fingerprint}`)
    .setSubject(qualifiedUser)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SNOWFLAKE_KEY_PAIR_JWT_TTL_SECONDS)
    .sign(key)
}

export interface SnowflakeConnectionSecret {
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
): Promise<SnowflakeConnectionSecret> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedConfigSchema,
    'Snowflake connection'
  )
  if (!parsed.success) throw new SnowflakeCredentialError(parsed.message)
  if (!(await isWorkloadIdentityConfigured())) {
    throw new WorkloadIdentityNotConfiguredError('Use a programmatic access token.')
  }
  const { host, subject: submittedSubject, subjectProof, audience } = parsed.data
  const subject = bindWorkloadIdentitySubject({
    provider: 'snowflake',
    owner,
    storedSubject: readStoredSubject(owner.storedSecret),
    subject: submittedSubject,
    subjectProof,
  })

  const audienceField = storedAudienceField(audience, SNOWFLAKE_WORKLOAD_IDENTITY_AUDIENCE)
  const validation = await validateSnowflakeWorkloadIdentity({
    domain: host,
    subjectToken: await mintSnowflakeToken({ subject, ...audienceField }, owner),
  })
  const config: StoredConfig = {
    authType: 'workload_identity',
    host: validation.normalizedDomain ?? host,
    subject,
    ...audienceField,
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
 * Validates and saves a configured (non-token) Snowflake connection: keyless
 * workload identity, or a key pair. The configuration's `authType` picks the
 * mode, and each mode is then parsed by its own strict schema.
 */
export async function verifyAndEncryptSnowflakeConnection(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<SnowflakeConnectionSecret> {
  const mode = parseServiceAccountConfig(serialized, submittedModeSchema, 'Snowflake connection')
  if (!mode.success) throw new SnowflakeCredentialError(mode.message)
  return mode.data.authType === 'key_pair'
    ? verifyAndEncryptSnowflakeKeyPairCredential(serialized)
    : verifyAndEncryptSnowflakeKeylessCredential(serialized, owner)
}

/**
 * Validates a key-pair configuration, proves Snowflake accepts a JWT signed
 * with its key for its user by running the identity statement, and returns the
 * encrypted blob holding the key. No workload identity is involved, so it
 * works for organization credentials and on deployments that cannot sign.
 */
async function verifyAndEncryptSnowflakeKeyPairCredential(
  serialized: string
): Promise<SnowflakeConnectionSecret> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedKeyPairSchema,
    'Snowflake connection'
  )
  if (!parsed.success) throw new SnowflakeCredentialError(parsed.message)
  const { host, user, privateKey } = parsed.data
  const validation = await validateSnowflakeKeyPair({
    domain: host,
    jwt: await signSnowflakeKeyPairJwt({ host, user, privateKey }),
  })
  const config: StoredKeyPairConfig = {
    authType: 'key_pair',
    host: validation.normalizedDomain ?? host,
    user,
    privateKey,
  }
  const principalMetadata = serviceAccountPrincipalMetadata(validation.principal)
  const { encrypted } = await encryptSecret(
    JSON.stringify({
      type: SNOWFLAKE_KEY_PAIR_SECRET_TYPE,
      config,
      metadata: { ...validation.storedMetadata, ...principalMetadata },
    })
  )
  return {
    encryptedServiceAccountKey: encrypted,
    displayName: validation.displayName,
    auditMetadata: { ...validation.auditMetadata, ...principalMetadata },
    principal: validation.principal,
  }
}

/**
 * Resolves an executor-authorized Snowflake credential (the executor already
 * checked the caller may use it) to the token and account host the tools send.
 * A programmatic access token resolves exactly as every token-paste credential
 * does; a keyless credential mints a token for its own subject, and a key-pair
 * credential signs a JWT with its key, each saying so in `authStyle`, which is
 * the only thing that switches the tools' token type.
 */
export async function resolveSnowflakeCredentialToken(credentialId: string): Promise<{
  accessToken: string
  domain?: string
  providerWorkspaceId?: string
  authStyle?: typeof SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE | typeof SNOWFLAKE_KEY_PAIR_AUTH_STYLE
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
  const stored: unknown = JSON.parse(decrypted)
  const keyPair = storedKeyPairSecretSchema.safeParse(stored)
  if (keyPair.success) {
    return {
      accessToken: await signSnowflakeKeyPairJwt(keyPair.data.config),
      domain: keyPair.data.config.host,
      authStyle: SNOWFLAKE_KEY_PAIR_AUTH_STYLE,
    }
  }
  const keyless = storedSecretSchema.safeParse(stored)
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
  const { config } = keyless.data
  const owner: WorkloadIdentityOwner = row.workspaceId
    ? { workspaceId: row.workspaceId }
    : { organizationId: row.organizationId ?? undefined }
  return {
    accessToken: await mintSnowflakeToken(config, owner),
    domain: config.host,
    authStyle: SNOWFLAKE_WORKLOAD_IDENTITY_AUTH_STYLE,
  }
}
