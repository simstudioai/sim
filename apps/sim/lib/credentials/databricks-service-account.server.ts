import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { validateDatabricksWorkspaceHost } from '@/lib/core/security/input-validation'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { failureClause, parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { WORKLOAD_IDENTITY_AUDIENCES } from '@/lib/credentials/workload-identity/audiences'
import {
  isWorkloadIdentityConfigured,
  MAX_WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS,
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
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/**
 * Saved Databricks connections for the Databricks block.
 *
 * - `personal_access_token`: a PAT used as-is, like an inline token.
 * - `service_principal`: OAuth machine-to-machine — the service principal's
 *   client ID and secret mint a workspace token per run.
 * - `oidc_federation`: no stored secret — Sim signs a short-lived OIDC token
 *   for this credential's subject and exchanges it (RFC 8693) for a token of
 *   the service principal whose federation policy trusts it.
 *
 * Every mode resolves server-side to a bearer token plus the workspace host
 * (`accessToken`, `domain`), which fill the tools' `apiKey` and `host`.
 */

const DATABRICKS_CREDENTIAL_SECRET_TYPE = 'databricks_credential_v1' as const
const DATABRICKS_WORKLOAD_IDENTITY_AUDIENCE = WORKLOAD_IDENTITY_AUDIENCES.databricks

const REQUEST_TIMEOUT_MS = 15_000
/** Token and identity responses are small; the cap keeps a misbehaving host from exhausting memory. */
const MAX_RESPONSE_BYTES = 1024 * 1024
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/

/** Workspace origin with Databricks' own host allowlist as the SSRF guard. */
function workspaceOrigin(host: string): string {
  const result = validateDatabricksWorkspaceHost(host.trim().replace(/^http:\/\//i, ''), 'host')
  if (!result.isValid || !result.sanitized) {
    throw new DatabricksCredentialError(result.error || 'Invalid Databricks workspace host')
  }
  return result.sanitized
}

const hostSchema = z
  .string()
  .trim()
  .min(1, 'Databricks workspace host is required')
  .max(255)
  .transform((value, context) => {
    try {
      return new URL(workspaceOrigin(value)).host
    } catch (error) {
      context.addIssue({ code: 'custom', message: getErrorMessage(error, 'Invalid host') })
      return z.NEVER
    }
  })

const clientIdSchema = z.string().trim().regex(CLIENT_ID_PATTERN, 'Invalid client ID')

const oidcShape = {
  authType: z.literal('oidc_federation'),
  host: hostSchema,
  clientId: clientIdSchema,
  subject: z.string().min(1).max(512),
}

const patSchema = z
  .object({
    authType: z.literal('personal_access_token'),
    host: hostSchema,
    token: z.string().trim().min(1, 'Personal access token is required').max(4096),
  })
  .strict()

const servicePrincipalSchema = z
  .object({
    authType: z.literal('service_principal'),
    host: hostSchema,
    clientId: clientIdSchema,
    clientSecret: z.string().min(1, 'OAuth secret is required').max(4096),
  })
  .strict()

const storedConfigSchema = z.discriminatedUnion('authType', [
  patSchema,
  servicePrincipalSchema,
  z.object(oidcShape).strict(),
])

type DatabricksCredentialConfig = z.infer<typeof storedConfigSchema>

const submittedConfigSchema = z.discriminatedUnion('authType', [
  patSchema,
  servicePrincipalSchema,
  z
    .object({
      ...oidcShape,
      subject: oidcShape.subject.optional(),
      subjectProof: z.string().min(1).max(512).optional(),
    })
    .strict(),
])

const storedSecretSchema = z
  .object({ type: z.literal(DATABRICKS_CREDENTIAL_SECRET_TYPE), config: storedConfigSchema })
  .strict()

export class DatabricksCredentialError extends Error {
  /** @param status Databricks' HTTP status, when Databricks itself refused the request. */
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'DatabricksCredentialError'
  }
}

async function requestWorkspaceToken(
  host: string,
  body: URLSearchParams,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {}
): Promise<string> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const url = `${workspaceOrigin(host)}/oidc/v1/token`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body,
      // A secret or subject token must never follow a redirect off the workspace host.
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch {
    signal?.throwIfAborted()
    // A network failure, timeout, or refused redirect says nothing about the credential.
    throw new DatabricksCredentialError('Could not reach the Databricks workspace', 502)
  }
  const payload = (await readResponseJsonWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Databricks token response',
  }).catch((error: unknown) => {
    if (error instanceof SyntaxError) return {}
    signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) {
      // A refusal's status still holds; an oversized success is the provider misbehaving.
      throw new DatabricksCredentialError(
        'Databricks token response exceeded the size limit',
        response.ok ? 502 : response.status
      )
    }
    // An interrupted body says nothing about the credential, whatever the status line was.
    throw new DatabricksCredentialError('Databricks token response could not be read', 502)
  })) as {
    access_token?: unknown
    error_description?: unknown
    error?: unknown
  }
  if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
    const reason =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
    throw new DatabricksCredentialError(
      `Databricks rejected the token request: ${reason}`,
      response.status
    )
  }
  return payload.access_token
}

/** A bearer token for the configured workspace. */
async function resolveDatabricksAccessToken(
  config: DatabricksCredentialConfig,
  owner: WorkloadIdentityOwner,
  signal?: AbortSignal
): Promise<string> {
  if (config.authType === 'personal_access_token') return config.token
  if (config.authType === 'service_principal') {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    return requestWorkspaceToken(
      config.host,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }),
      signal,
      { Authorization: `Basic ${basic}` }
    )
  }
  const subjectToken = await mintWorkloadIdentityToken({
    subject: config.subject,
    audience: DATABRICKS_WORKLOAD_IDENTITY_AUDIENCE,
    owner,
    // Databricks' token expires with this one, and Genie polls for up to five minutes.
    ttlSeconds: MAX_WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS,
  })
  return requestWorkspaceToken(
    config.host,
    new URLSearchParams({
      client_id: config.clientId,
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      scope: 'all-apis',
    }),
    signal
  )
}

/** The auth mode a decrypted Databricks secret holds, or undefined when it is not one. */
export function storedDatabricksAuthType(
  decrypted: string
): DatabricksCredentialConfig['authType'] | undefined {
  try {
    const parsed = storedSecretSchema.safeParse(JSON.parse(decrypted))
    return parsed.success ? parsed.data.config.authType : undefined
  } catch {
    return undefined
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success && parsed.data.config.authType === 'oidc_federation'
    ? parsed.data.config.subject
    : undefined
}

function bindSubject(
  subject: string | undefined,
  subjectProof: string | undefined,
  owner: WorkloadIdentityCredentialOwner
): string {
  return bindWorkloadIdentitySubject({
    provider: 'databricks',
    owner,
    storedSubject: readStoredSubject(owner.storedSecret),
    subject,
    subjectProof,
  })
}

/** Proves a configuration by calling the workspace's SCIM `Me` with the resolved token. */
async function verifyWorkspaceIdentity(
  config: DatabricksCredentialConfig,
  owner: WorkloadIdentityOwner
): Promise<string> {
  try {
    const token = await resolveDatabricksAccessToken(config, owner)
    const response = await fetch(`${workspaceOrigin(config.host)}/api/2.0/preview/scim/v2/Me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`workspace returned HTTP ${response.status}`)
    // A malformed body only loses the display name; an oversized one must fail
    // verification rather than save the host as the identity.
    const me = (await readResponseJsonWithLimit(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      label: 'Databricks identity response',
    }).catch((error: unknown) => {
      if (error instanceof SyntaxError) return {}
      throw error
    })) as {
      userName?: unknown
      displayName?: unknown
    }
    return (
      (typeof me.userName === 'string' && me.userName) ||
      (typeof me.displayName === 'string' && me.displayName) ||
      config.host
    )
  } catch (error) {
    // A keyless refusal already names its cause and code; wrapping it would lose both.
    if (error instanceof KeylessCredentialRefusedError) throw error
    throw new DatabricksCredentialError(
      `Could not verify the Databricks credential: ${getErrorMessage(error, 'Unknown error')}`
    )
  }
}

/**
 * Sim signs tokens for any service principal a member names, and every Sim
 * tenant shares the issuer and audience, so a federation policy that matches on
 * a claim other than `sub` (a `subject_claim` of `sim_workspace_id`, say) would
 * let other Sim credentials act as the principal. Exchanging a subject no
 * credential holds must be refused before the credential is saved.
 */
async function assertPolicyPinsSubject(
  config: Extract<DatabricksCredentialConfig, { authType: 'oidc_federation' }>,
  owner: WorkloadIdentityOwner
): Promise<void> {
  try {
    await resolveDatabricksAccessToken(
      { ...config, subject: newWorkloadIdentitySubject(owner) },
      owner,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    )
  } catch (error) {
    const refused =
      error instanceof DatabricksCredentialError &&
      error.status !== undefined &&
      providerFailureCode(error.status) === 'invalid_credentials'
    if (refused) return
    if (error instanceof KeylessCredentialRefusedError) throw error
    throw new DatabricksCredentialError(
      `Sim could not confirm the federation policy limits this service principal to this credential: ${failureClause(error)}. Try again.`
    )
  }
  throw new DatabricksCredentialError(
    `This service principal's federation policy also trusts other Sim credentials. Use the federation policy from Sim (the connect dialog or \`sim credentials keyless-subject\`), which matches the sub claim to ${config.subject}, so only this credential can use it.`
  )
}

/**
 * Validates the submitted configuration, proves it by calling the workspace's
 * SCIM `Me` endpoint with the resolved token, and returns the encrypted blob,
 * the identity Databricks reports, and the keyless subject it newly binds, if
 * any (a reconnect keeping its stored subject binds none).
 */
export async function verifyAndEncryptDatabricksCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<{ encryptedServiceAccountKey: string; identity: string; newSubject?: string }> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedConfigSchema,
    'Databricks credential'
  )
  if (!parsed.success) throw new DatabricksCredentialError(parsed.message)
  const submitted = parsed.data
  let config: DatabricksCredentialConfig
  if (submitted.authType === 'oidc_federation') {
    if (!(await isWorkloadIdentityConfigured())) {
      throw new WorkloadIdentityNotConfiguredError(
        'Use a personal access token or a service principal OAuth secret.'
      )
    }
    const { subject, subjectProof, ...rest } = submitted
    config = { ...rest, subject: bindSubject(subject, subjectProof, owner) }
  } else {
    config = submitted
  }

  // The subject-pin probe is independent of the verification, so both run at
  // once; a verification failure still reports first.
  const [verified, pinned] = await Promise.allSettled([
    verifyWorkspaceIdentity(config, owner),
    config.authType === 'oidc_federation' ? assertPolicyPinsSubject(config, owner) : undefined,
  ])
  if (verified.status === 'rejected') throw verified.reason
  if (pinned.status === 'rejected') throw pinned.reason
  const identity = verified.value

  const { encrypted } = await encryptSecret(
    JSON.stringify({ type: DATABRICKS_CREDENTIAL_SECRET_TYPE, config })
  )
  return {
    encryptedServiceAccountKey: encrypted,
    identity,
    ...(config.authType === 'oidc_federation' &&
    config.subject !== readStoredSubject(owner.storedSecret)
      ? { newSubject: config.subject }
      : {}),
  }
}

/**
 * Resolves an executor-authorized Databricks credential (the executor already
 * checked the caller may use it) to a token and its workspace host.
 */
export async function resolveDatabricksCredentialToken(
  credentialId: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; domain: string }> {
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
    .where(eq(credential.id, credentialId))
    .limit(1)
  if (
    !row ||
    row.type !== 'service_account' ||
    row.providerId !== DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  ) {
    throw new DatabricksCredentialError('Databricks credential is unavailable')
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  const { config } = storedSecretSchema.parse(JSON.parse(decrypted))
  const owner: WorkloadIdentityOwner = row.workspaceId
    ? { workspaceId: row.workspaceId }
    : { organizationId: row.organizationId ?? undefined }
  try {
    return {
      accessToken: await resolveDatabricksAccessToken(config, owner, signal),
      domain: config.host,
    }
  } catch (error) {
    if (!(error instanceof DatabricksCredentialError)) throw error
    // Report in the shared service-account codes: an outage is not a bad credential.
    throw new TokenServiceAccountValidationError(
      error.status === undefined ? 'invalid_credentials' : providerFailureCode(error.status),
      error.status ?? 400,
      { step: 'token', reason: error.message }
    )
  }
}
