import {
  AssumeRoleCommand,
  AssumeRoleWithWebIdentityCommand,
  type Credentials,
  GetCallerIdentityCommand,
  STSClient,
} from '@aws-sdk/client-sts'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { failureClause, parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import { WORKLOAD_IDENTITY_AUDIENCES } from '@/lib/credentials/workload-identity/audiences'
import {
  isWorkloadIdentityConfigured,
  mintWorkloadIdentityToken,
  type WorkloadIdentityOwner,
} from '@/lib/credentials/workload-identity/issuer'
import {
  bindWorkloadIdentitySubject,
  KeylessCredentialRefusedError,
  newWorkloadIdentitySubject,
  type WorkloadIdentityCredentialOwner,
  WorkloadIdentityNotConfiguredError,
} from '@/lib/credentials/workload-identity/subject'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/**
 * Saved AWS identities for every AWS block.
 *
 * Three modes, all resolved server-side at execution. The stored keys and the
 * sessions resolved from them stay out of block outputs, logs, and model input,
 * with two exceptions: an S3 presigned URL made with temporary credentials
 * carries the temporary access key ID and session token (never the secret), and
 * stops working when that session ends, so its expiry can't outlast the session;
 * operations whose purpose is to issue AWS credentials (STS assume role and get
 * session token, IAM create access key) return the credentials they issue, as
 * the same operations do with inline keys. Using a credential therefore includes
 * issuing whatever its IAM permissions allow.
 * - `access_keys`: a long-lived IAM user key pair, used as-is, like inline keys.
 * - `assume_role`: a key pair that assumes a role, optionally with an external ID.
 * - `oidc_role`: no stored key at all — Sim signs a short-lived OIDC token for
 *   this credential's subject and exchanges it with STS for the customer's role.
 */

const AWS_WORKLOAD_IDENTITY_AUDIENCE = WORKLOAD_IDENTITY_AUDIENCES.aws
const AWS_CREDENTIAL_SECRET_TYPE = 'aws_credential_v1' as const

const ROLE_ARN_PATTERN =
  /^arn:aws(?:-cn|-us-gov|-iso[a-z-]*)?:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/
const ACCESS_KEY_ID_PATTERN = /^[A-Z0-9]{16,128}$/
const EXTERNAL_ID_PATTERN = /^[\w+=,.@:/-]{2,1224}$/
const VERIFY_TIMEOUT_MS = 20_000

const keyPairShape = {
  accessKeyId: z.string().trim().regex(ACCESS_KEY_ID_PATTERN, 'Invalid AWS access key ID'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required').max(256),
}

const commonShape = {
  stsRegion: z.string().trim().regex(REGION_PATTERN, 'Invalid AWS region').optional(),
  sessionDurationSeconds: z.number().int().min(900).max(43_200).optional(),
}

const roleArnSchema = z.string().trim().regex(ROLE_ARN_PATTERN, 'Invalid IAM role ARN')

const accessKeysSchema = z
  .object({ authType: z.literal('access_keys'), ...keyPairShape, ...commonShape })
  .strict()

const assumeRoleSchema = z
  .object({
    authType: z.literal('assume_role'),
    ...keyPairShape,
    roleArn: roleArnSchema,
    externalId: z.string().regex(EXTERNAL_ID_PATTERN, 'Invalid external ID').optional(),
    ...commonShape,
  })
  .strict()

const oidcRoleShape = {
  authType: z.literal('oidc_role'),
  roleArn: roleArnSchema,
  subject: z.string().min(1).max(512),
  ...commonShape,
}

const storedConfigSchema = z.discriminatedUnion('authType', [
  accessKeysSchema,
  assumeRoleSchema,
  z.object(oidcRoleShape).strict(),
])

export type AwsCredentialConfig = z.infer<typeof storedConfigSchema>

/**
 * What the connect modal submits. A new keyless role carries the subject Sim
 * issued and its proof; a reconnect that keeps the configured trust omits both.
 */
const submittedConfigSchema = z.discriminatedUnion('authType', [
  accessKeysSchema,
  assumeRoleSchema,
  z
    .object({
      ...oidcRoleShape,
      subject: oidcRoleShape.subject.optional(),
      subjectProof: z.string().min(1).max(512).optional(),
    })
    .strict(),
])

const storedSecretSchema = z
  .object({ type: z.literal(AWS_CREDENTIAL_SECRET_TYPE), config: storedConfigSchema })
  .strict()

export class AwsCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AwsCredentialError'
  }
}

export interface AwsSessionCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** The STS session length Sim requested; long-lived access keys have none. */
  durationSeconds?: number
  /** When an STS session ends; long-lived access keys have none. */
  expiration?: Date
}

/** STS lives in every partition; a role's partition decides the default endpoint. */
function defaultStsRegion(roleArn?: string): string {
  if (roleArn?.startsWith('arn:aws-cn:')) return 'cn-north-1'
  if (roleArn?.startsWith('arn:aws-us-gov:')) return 'us-gov-west-1'
  return 'us-east-1'
}

function stsRegionFor(config: AwsCredentialConfig): string {
  return config.stsRegion ?? defaultStsRegion('roleArn' in config ? config.roleArn : undefined)
}

/** RoleSessionName allows `[\w+=,.@-]{2,64}` and shows up in the customer's CloudTrail. */
export function buildAwsRoleSessionName(label: string | undefined): string {
  const cleaned = (label ?? '').replace(/[^\w+=,.@-]/g, '-').slice(0, 56)
  return `sim-${cleaned || 'credential'}`
}

function toSessionCredentials(
  credentials: Credentials | undefined,
  durationSeconds: number
): AwsSessionCredentials {
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
    throw new AwsCredentialError('AWS STS returned no credentials')
  }
  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
    durationSeconds,
    ...(credentials.Expiration ? { expiration: credentials.Expiration } : {}),
  }
}

/**
 * Exchanges a saved AWS identity for credentials an SDK client can sign with.
 * `access_keys` return the stored pair unchanged (no session token), so a
 * credential behaves exactly like the inline keys it replaces.
 */
export async function resolveAwsSessionCredentials(
  config: AwsCredentialConfig,
  owner: WorkloadIdentityOwner,
  options: { roleSessionName: string; signal?: AbortSignal }
): Promise<AwsSessionCredentials> {
  if (config.authType === 'access_keys') {
    return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  }
  const region = stsRegionFor(config)
  const durationSeconds = config.sessionDurationSeconds ?? 3600
  if (config.authType === 'assume_role') {
    const client = new STSClient({
      region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: awsRequestHandler(),
    })
    const response = await client.send(
      new AssumeRoleCommand({
        RoleArn: config.roleArn,
        RoleSessionName: options.roleSessionName,
        DurationSeconds: durationSeconds,
        ...(config.externalId ? { ExternalId: config.externalId } : {}),
      }),
      { abortSignal: options.signal }
    )
    return toSessionCredentials(response.Credentials, durationSeconds)
  }
  const webIdentityToken = await mintWorkloadIdentityToken({
    subject: config.subject,
    audience: AWS_WORKLOAD_IDENTITY_AUDIENCE,
    owner,
  })
  /**
   * AWS does not check the request signature for AssumeRoleWithWebIdentity;
   * placeholder credentials keep the SDK off the ambient provider chain so the
   * request never signs with Sim's own task role.
   */
  const client = new STSClient({
    region,
    credentials: { accessKeyId: 'anonymous', secretAccessKey: 'anonymous' },
    requestHandler: awsRequestHandler(),
  })
  const response = await client.send(
    new AssumeRoleWithWebIdentityCommand({
      RoleArn: config.roleArn,
      RoleSessionName: options.roleSessionName,
      WebIdentityToken: webIdentityToken,
      DurationSeconds: durationSeconds,
    }),
    { abortSignal: options.signal }
  )
  return toSessionCredentials(response.Credentials, durationSeconds)
}

/** The auth mode a decrypted AWS secret holds, or undefined when it is not one. */
export function storedAwsAuthType(decrypted: string): AwsCredentialConfig['authType'] | undefined {
  try {
    const parsed = storedSecretSchema.safeParse(JSON.parse(decrypted))
    return parsed.success ? parsed.data.config.authType : undefined
  } catch {
    return undefined
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success && parsed.data.config.authType === 'oidc_role'
    ? parsed.data.config.subject
    : undefined
}

function bindSubject(
  subject: string | undefined,
  subjectProof: string | undefined,
  storedSubject: string | undefined,
  owner: WorkloadIdentityCredentialOwner
): string {
  return bindWorkloadIdentitySubject({
    provider: 'aws',
    owner,
    storedSubject,
    subject,
    subjectProof,
  })
}

function verificationFailure(config: AwsCredentialConfig, error: unknown): Error {
  // A keyless refusal already names its cause and code; wrapping it would lose both.
  if (error instanceof KeylessCredentialRefusedError) return error
  const detail = failureClause(error)
  if (config.authType === 'oidc_role') {
    return new AwsCredentialError(
      `Sim could not assume this role: ${detail}. Check that the role trusts the Sim OIDC provider with this exact subject and audience ${AWS_WORKLOAD_IDENTITY_AUDIENCE}.`
    )
  }
  if (config.authType === 'assume_role') {
    return new AwsCredentialError(
      `Sim could not assume this role with the access keys: ${detail}. Check the role ARN, its trust policy, and the external ID.`
    )
  }
  return new AwsCredentialError(`AWS rejected these access keys: ${detail}`)
}

/**
 * Validates the submitted configuration, proves it works by resolving it and
 * calling `sts:GetCallerIdentity`, and returns the encrypted blob, the caller
 * ARN AWS reports, and the keyless subject it newly binds, if any (a
 * reconnect keeping its stored subject binds none).
 */
export async function verifyAndEncryptAwsCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<{ encryptedServiceAccountKey: string; callerArn: string; newSubject?: string }> {
  const parsed = parseServiceAccountConfig(serialized, submittedConfigSchema, 'AWS credential')
  if (!parsed.success) throw new AwsCredentialError(parsed.message)
  const submitted = parsed.data
  let config: AwsCredentialConfig
  if (submitted.authType === 'oidc_role') {
    if (!(await isWorkloadIdentityConfigured())) {
      throw new WorkloadIdentityNotConfiguredError('Use access keys.')
    }
    const { subject, subjectProof, ...rest } = submitted
    config = {
      ...rest,
      subject: bindSubject(subject, subjectProof, readStoredSubject(owner.storedSecret), owner),
    }
  } else {
    config = submitted
  }

  // The trust-pin probe is independent of the verification, so both run at once;
  // a verification failure still reports first.
  const [verified, pinned] = await Promise.allSettled([
    verifyCallerArn(config, owner),
    config.authType === 'oidc_role' ? assertRolePinsSubject(config, owner) : undefined,
  ])
  if (verified.status === 'rejected') throw verificationFailure(config, verified.reason)
  if (pinned.status === 'rejected') throw pinned.reason
  const callerArn = verified.value

  const { encrypted } = await encryptSecret(
    JSON.stringify({ type: AWS_CREDENTIAL_SECRET_TYPE, config })
  )
  return {
    encryptedServiceAccountKey: encrypted,
    callerArn,
    ...(config.authType === 'oidc_role' && config.subject !== readStoredSubject(owner.storedSecret)
      ? { newSubject: config.subject }
      : {}),
  }
}

/** Resolves the configuration and returns the caller ARN AWS reports for it. */
async function verifyCallerArn(
  config: AwsCredentialConfig,
  owner: WorkloadIdentityOwner
): Promise<string> {
  const signal = AbortSignal.timeout(VERIFY_TIMEOUT_MS)
  const session = await resolveAwsSessionCredentials(config, owner, {
    roleSessionName: buildAwsRoleSessionName('verify'),
    signal,
  })
  const identity = await new STSClient({
    region: stsRegionFor(config),
    credentials: session,
    requestHandler: awsRequestHandler(),
  }).send(new GetCallerIdentityCommand({}), { abortSignal: signal })
  if (!identity.Arn) throw new Error('AWS returned no caller identity')
  return identity.Arn
}

/**
 * Sim signs tokens for any role ARN a member types in, so a role that trusts
 * Sim's issuer without pinning `sub` could be assumed from any Sim workspace.
 * Retrying the role with a subject no credential holds must be denied before
 * the credential is saved.
 */
async function assertRolePinsSubject(
  config: Extract<AwsCredentialConfig, { authType: 'oidc_role' }>,
  owner: WorkloadIdentityOwner
): Promise<void> {
  const unboundSubject = newWorkloadIdentitySubject(owner)
  try {
    await resolveAwsSessionCredentials({ ...config, subject: unboundSubject }, owner, {
      roleSessionName: buildAwsRoleSessionName('verify'),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AccessDenied') return
    if (error instanceof KeylessCredentialRefusedError) throw error
    throw new AwsCredentialError(
      `Sim could not confirm the role's trust policy limits it to this credential: ${failureClause(error)}. Try again.`
    )
  }
  throw new AwsCredentialError(
    `This role trusts every Sim subject. Use the trust policy from Sim (the connect dialog or \`sim credentials keyless-subject\`), whose sub condition pins ${config.subject}, so only this credential can assume the role.`
  )
}

/**
 * Loads an executor-authorized AWS credential bound to its trusted owner
 * scope. The executor has already authorized the acting user's use of the
 * credential; this re-checks that the row belongs to the run's own workspace
 * or organization and is a live AWS credential before decrypting it.
 */
export async function getAwsCredentialConfig(
  credentialId: string,
  scope: WorkloadIdentityOwner
): Promise<{ config: AwsCredentialConfig; owner: WorkloadIdentityOwner }> {
  const unavailable = () => new AwsCredentialError('AWS credential is unavailable')
  if (!credentialId || (!scope.workspaceId && !scope.organizationId)) throw unavailable()
  const [row] = await db
    .select({
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      type: credential.type,
      providerId: credential.providerId,
      revokedAt: credential.revokedAt,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(
      and(
        eq(credential.id, credentialId),
        or(
          scope.workspaceId
            ? and(eq(credential.workspaceId, scope.workspaceId), isNull(credential.organizationId))
            : undefined,
          scope.organizationId
            ? and(
                eq(credential.organizationId, scope.organizationId),
                isNull(credential.workspaceId)
              )
            : undefined
        )
      )
    )
    .limit(1)
  const ownerMatches =
    row &&
    ((row.workspaceId === scope.workspaceId &&
      !!scope.workspaceId &&
      row.organizationId === null) ||
      (row.organizationId === scope.organizationId &&
        !!scope.organizationId &&
        row.workspaceId === null))
  if (
    !ownerMatches ||
    row.type !== 'service_account' ||
    row.providerId !== AWS_SERVICE_ACCOUNT_PROVIDER_ID ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  )
    throw unavailable()
  try {
    const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
    const { config } = storedSecretSchema.parse(JSON.parse(decrypted))
    return {
      config,
      owner: row.workspaceId
        ? { workspaceId: row.workspaceId }
        : { organizationId: row.organizationId ?? undefined },
    }
  } catch {
    throw unavailable()
  }
}
