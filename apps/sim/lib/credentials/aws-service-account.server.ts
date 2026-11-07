import {
  AssumeRoleCommand,
  AssumeRoleWithWebIdentityCommand,
  type Credentials,
  GetCallerIdentityCommand,
  STSClient,
} from '@aws-sdk/client-sts'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { WORKLOAD_IDENTITY_AUDIENCES } from '@/lib/credentials/workload-identity/audiences'
import {
  mintWorkloadIdentityToken,
  type WorkloadIdentityOwner,
} from '@/lib/credentials/workload-identity/issuer'
import {
  verifyWorkloadIdentitySubject,
  type WorkloadIdentityCredentialOwner,
  WorkloadIdentitySubjectError,
} from '@/lib/credentials/workload-identity/subject'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/**
 * Saved AWS identities for every AWS block.
 *
 * Three modes, all resolved server-side at execution. Keys and session tokens
 * stay out of block outputs, logs, and model input — except where AWS itself
 * requires them in a value the block returns: an S3 presigned download URL made
 * with temporary credentials carries the temporary access key ID and its
 * session token (never the secret), and expires with the session.
 * - `access_keys`: a long-lived IAM user key pair, used as-is (today's inline behavior).
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

/** What the connect modal submits: the stored shape plus a one-time subject proof for OIDC roles. */
const submittedConfigSchema = z.discriminatedUnion('authType', [
  accessKeysSchema,
  assumeRoleSchema,
  z.object({ ...oidcRoleShape, subjectProof: z.string().min(1).max(512).optional() }).strict(),
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

function toSessionCredentials(credentials: Credentials | undefined): AwsSessionCredentials {
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
    throw new AwsCredentialError('AWS STS returned no credentials')
  }
  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
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
    return toSessionCredentials(response.Credentials)
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
  return toSessionCredentials(response.Credentials)
}

function parseSubmittedConfig(serialized: string) {
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new AwsCredentialError('AWS credential configuration is too large')
  }
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch {
    throw new AwsCredentialError('Invalid AWS credential configuration')
  }
  const parsed = submittedConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AwsCredentialError(parsed.error.issues[0]?.message ?? 'Invalid AWS credential')
  }
  return parsed.data
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success && parsed.data.config.authType === 'oidc_role'
    ? parsed.data.config.subject
    : undefined
}

/**
 * Binds an OIDC subject to the credential. A reconnect may keep the subject it
 * already has; any other subject needs a fresh, unexpired proof Sim issued to
 * this person for this owner.
 */
function bindOidcSubject(
  subject: string,
  subjectProof: string | undefined,
  owner: WorkloadIdentityCredentialOwner
): string {
  if (subject === readStoredSubject(owner.storedSecret)) return subject
  if (!subjectProof) {
    throw new AwsCredentialError('Start a new AWS role connection to get a trust setup')
  }
  try {
    verifyWorkloadIdentitySubject('aws', owner, owner.actorUserId, subject, subjectProof)
  } catch (error) {
    if (error instanceof WorkloadIdentitySubjectError) throw new AwsCredentialError(error.message)
    throw error
  }
  return subject
}

function verificationFailure(config: AwsCredentialConfig, error: unknown): AwsCredentialError {
  const detail = getErrorMessage(error, 'Unknown error')
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
 * calling `sts:GetCallerIdentity`, and returns the encrypted blob plus the
 * caller ARN AWS reports.
 */
export async function verifyAndEncryptAwsCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<{ encryptedServiceAccountKey: string; callerArn: string }> {
  const submitted = parseSubmittedConfig(serialized)
  let config: AwsCredentialConfig
  if (submitted.authType === 'oidc_role') {
    const { subjectProof, ...rest } = submitted
    config = { ...rest, subject: bindOidcSubject(rest.subject, subjectProof, owner) }
  } else {
    config = submitted
  }

  let callerArn: string
  try {
    const signal = AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    const session = await resolveAwsSessionCredentials(config, owner, {
      roleSessionName: buildAwsRoleSessionName('verify'),
      signal,
    })
    const identity = await new STSClient({
      region: stsRegionFor(config),
      credentials: session,
    }).send(new GetCallerIdentityCommand({}), { abortSignal: signal })
    if (!identity.Arn) throw new Error('AWS returned no caller identity')
    callerArn = identity.Arn
  } catch (error) {
    throw verificationFailure(config, error)
  }

  const { encrypted } = await encryptSecret(
    JSON.stringify({ type: AWS_CREDENTIAL_SECRET_TYPE, config })
  )
  return { encryptedServiceAccountKey: encrypted, callerArn }
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
